import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Stripe from "stripe";
import type { AddressInfo } from "node:net";

// Isolate API behavior from Stripe and the real database.
let rpcCalls: Record<string, unknown>[] = [];
let rpcError: unknown = null;
let order = { order_number: 42, payment_status: "unpaid", total: 25000, currency: "SEK" };
let session = {
  id: "cs_test_example", metadata: { order_id: "order-id" },
  payment_status: "paid", status: "complete", amount_total: 25000,
  currency: "sek", payment_intent: "pi_example",
  customer_details: { name: "Test", email: "test@example.com" },
  collected_information: { shipping_details: { name: "Test", address: { country: "SE" } } },
} as unknown as Stripe.Checkout.Session;

function replaceModule(path: string, exports: unknown) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports } as NodeModule;
}
replaceModule("../supabaseAdmin", { __esModule: true, default: {
  rpc: async (_name: string, args: Record<string, unknown>) => {
    rpcCalls.push(args);
    return { error: rpcError };
  },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: order, error: null }) }) }) }),
} });
const stripe = new Stripe("sk_test_placeholder");
stripe.checkout.sessions.retrieve = (async () => session) as unknown as typeof stripe.checkout.sessions.retrieve;
replaceModule("../lib/stripe", { stripe });
const { syncCheckoutStatus } = require("../lib/checkoutStatus") as typeof import("../lib/checkoutStatus");
const checkout = require("../routes/checkout").default;
const webhook = require("../routes/stripeWebhook").default;

test("checkout payment handling", async (t) => {
  const app = express();
  app.use("/webhooks/stripe", express.raw({ type: "application/json" }), webhook);
  app.use(express.json());
  app.use("/checkout", checkout);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  try {
    await t.test("paid data and customer details are passed to the atomic transaction", async () => {
      await syncCheckoutStatus(session);
      assert.equal(rpcCalls[rpcCalls.length - 1]?.p_state, "paid");
      assert.equal(rpcCalls[rpcCalls.length - 1]?.p_total, 25000);
      assert.equal(rpcCalls[rpcCalls.length - 1]?.p_session_id, session.id);
      assert.deepEqual(rpcCalls[rpcCalls.length - 1]?.p_customer, session.customer_details);
    });
    await t.test("unpaid completion stays pending; failure and expiration are distinct", async () => {
      const unpaid = { ...session, payment_status: "unpaid" } as Stripe.Checkout.Session;
      await syncCheckoutStatus(unpaid);
      assert.equal(rpcCalls[rpcCalls.length - 1]?.p_state, "pending");
      await syncCheckoutStatus(unpaid, "failed");
      assert.equal(rpcCalls[rpcCalls.length - 1]?.p_state, "failed");
      await syncCheckoutStatus(unpaid, "expired");
      assert.equal(rpcCalls[rpcCalls.length - 1]?.p_state, "expired");
      await syncCheckoutStatus(session, "failed");
      assert.equal(rpcCalls[rpcCalls.length - 1]?.p_state, "paid");
    });
    await t.test("database errors propagate for Stripe retries", async () => {
      rpcError = new Error("database unavailable");
      await assert.rejects(syncCheckoutStatus(session));
      rpcError = null;
    });
    await t.test("invalid carts are rejected before creating a payment", async () => {
      const response = await fetch(`${base}/checkout/session`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [] }),
      });
      assert.equal(response.status, 400);
    });
    await t.test("receipt verifies payment and returns no customer data", async () => {
      const response = await fetch(`${base}/checkout/session/cs_test_example`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        orderNumber: 42, paymentStatus: "paid", expired: false, total: 25000, currency: "SEK",
      });
    });
    await t.test("unsigned webhooks are rejected", async () => {
      const before = rpcCalls.length;
      const response = await fetch(`${base}/webhooks/stripe`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      assert.equal(response.status, 400);
      assert.equal(rpcCalls.length, before);
    });
    await t.test("signed webhook synchronizes the current Stripe session", async () => {
      const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: session.id } } });
      const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
      const before = rpcCalls.length;
      const response = await fetch(`${base}/webhooks/stripe`, {
        method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": signature }, body: payload,
      });
      assert.equal(response.status, 200);
      assert.equal(rpcCalls.length, before + 1);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
