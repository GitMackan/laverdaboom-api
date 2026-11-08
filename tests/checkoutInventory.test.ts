import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";

const variantId = "10000000-0000-4000-8000-000000000001";
const orderId = "20000000-0000-4000-8000-000000000001";
let calls: string[] = [];
let reservationError: unknown = null;
let createError = false, linkError = false, expireError = false;
let stripeStatus = "open", paymentStatus = "unpaid", intentStatus = "processing";
let reservedQuantity = 0;
let sessionParams: Record<string, unknown> = {};
const session = () => ({
  id: "cs_test_inventory", url: "https://checkout.stripe.com/test", status: stripeStatus,
  payment_status: paymentStatus, metadata: { order_id: orderId }, currency: "sek", amount_total: 10000,
  payment_intent: { id: "pi_inventory", status: intentStatus },
});

function replaceModule(path: string, exports: unknown) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports } as NodeModule;
}
replaceModule("../lib/stripe", { stripe: { checkout: { sessions: {
  create: async (params: Record<string, unknown>) => {
    calls.push("create-session"); sessionParams = params;
    if (createError) throw new Error("Stripe unavailable");
    return session();
  },
  retrieve: async () => { calls.push("retrieve-session"); return session(); },
  expire: async () => {
    calls.push("expire-session");
    if (expireError) throw new Error("Stripe unavailable");
    stripeStatus = "expired";
    return session();
  },
} } } });
replaceModule("../supabaseAdmin", { __esModule: true, default: {
  rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push(name === "reserve_order_inventory" ? "reserve" : `sync-${args.p_state}`);
    return { error: name === "reserve_order_inventory" ? reservationError : null };
  },
  from: (table: string) => {
    let updating = false;
    const query = {
      select: (_fields?: string) => query,
      order: (_field: string) => query,
      limit: (_limit: number) => query,
      gt: (_field: string, _value: string) => query,
      eq: (_field: string, _value: string) => query,
      delete: () => query,
      insert: (_values: unknown) => {
        calls.push(`insert-${table}`);
        return query;
      },
      update: (values: Record<string, unknown>) => {
        updating = true;
        calls.push(values.stripe_checkout_session_id ? "link-session" : "cancel-order");
        return query;
      },
      single: async () => ({ data: { id: orderId, order_number: 1 }, error: null }),
      in: async () => ({ data: [{
        id: variantId, product_id: "product", sku: null, price: 10000,
        stock_quantity: 1, reserved_quantity: reservedQuantity, made_to_order: false, active: true,
        products: { id: "product", name: "Test", active: true },
      }], error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
        data: table === "orders" && !updating ? [{ id: orderId, stripe_checkout_session_id: "cs_test_inventory" }] : null,
        error: updating && linkError ? { message: "Database unavailable" } : null,
      })),
    };
    return query;
  },
} });
const checkout = require("../routes/checkout").default;
const { reconcileInventory } = require("../lib/inventoryReconciliation") as typeof import("../lib/inventoryReconciliation");

test("checkout inventory lifecycle", async (t) => {
  const app = express();
  app.use(express.json());
  app.use("/checkout", checkout);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/checkout`;
  process.env.FRONTEND_URL = "http://localhost:3000";
  const reset = () => {
    calls = []; reservationError = null;
    createError = linkError = expireError = false;
    stripeStatus = "open"; paymentStatus = "unpaid"; intentStatus = "processing";
    reservedQuantity = 0;
  };
  const create = () => fetch(`${base}/session`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ variantId, quantity: 1 }] }),
  });
  const cancel = () => fetch(`${base}/session/cs_test_inventory/cancel`, { method: "POST" });
  try {
    await t.test("returns checkout URL only after linking and reserving", async () => {
      reset();
      const start = Math.floor(Date.now() / 1000);
      const response = await create();
      assert.equal(response.status, 200);
      assert.equal((await response.json()).sessionId, "cs_test_inventory");
      assert.deepEqual(calls, ["insert-orders", "insert-order_items", "create-session", "link-session", "reserve"]);
      assert.ok(Number(sessionParams.expires_at) >= start + 1800);
      assert.ok(Number(sessionParams.expires_at) <= start + 1802);
    });
    await t.test("stock conflict expires the checkout and returns a useful error", async () => {
      reset(); reservationError = { code: "P0001", message: "Otillräckligt lager." };
      const response = await create();
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: "Otillräckligt lager." });
      assert.ok(calls.includes("expire-session"));
      assert.ok(calls.includes("sync-expired"));
    });
    await t.test("already reserved stock returns actionable feedback before creating a session", async () => {
      reset(); reservedQuantity = 1;
      const response = await create();
      assert.equal(response.status, 409);
      const result = await response.json();
      assert.equal(result.variantId, variantId);
      assert.equal(result.availableQuantity, 0);
      assert.match(result.error, /Ta bort produkten/);
      assert.equal(calls.includes("create-session"), false);
    });
    await t.test("Stripe creation failure cannot leave a reservation", async () => {
      reset(); createError = true;
      assert.equal((await create()).status, 500);
      assert.equal(calls.includes("reserve"), false);
    });
    await t.test("linking failure closes the checkout without reserving", async () => {
      reset(); linkError = true;
      assert.equal((await create()).status, 500);
      assert.equal(calls.includes("reserve"), false);
      assert.ok(calls.includes("expire-session"));
    });
    await t.test("cancel expires before releasing and is idempotent", async () => {
      reset();
      assert.equal((await cancel()).status, 200);
      assert.deepEqual(calls, ["retrieve-session", "expire-session", "sync-expired"]);
      calls = [];
      assert.equal((await cancel()).status, 200);
      assert.deepEqual(calls, ["retrieve-session", "sync-expired"]);
    });
    await t.test("failed expiration never releases potentially payable stock", async () => {
      reset(); expireError = true;
      assert.equal((await cancel()).status, 503);
      assert.equal(calls.some((call) => call.startsWith("sync-")), false);
    });
    await t.test("a payment winning the cancellation race stays paid", async () => {
      reset(); stripeStatus = "complete"; paymentStatus = "paid";
      const response = await cancel();
      assert.equal(response.status, 200);
      assert.equal((await response.json()).paymentStatus, "paid");
      assert.deepEqual(calls, ["retrieve-session", "sync-paid"]);
    });
    await t.test("reconciliation repairs missed paid, expired and failed events", async () => {
      for (const scenario of ["paid", "expired", "failed", "processing"]) {
        reset();
        stripeStatus = scenario === "expired" ? "expired" : "complete";
        paymentStatus = scenario === "paid" ? "paid" : "unpaid";
        intentStatus = scenario === "failed" ? "requires_payment_method" : "processing";
        await reconcileInventory();
        assert.deepEqual(calls, scenario === "processing"
          ? ["retrieve-session"] : ["retrieve-session", `sync-${scenario}`]);
      }
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
