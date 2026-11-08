import { test } from "node:test";
import assert from "node:assert/strict";
let smtpError: unknown = null;
let recordError = false;
let updates: Record<string, unknown>[] = [];
let messages: Record<string, unknown>[] = [];
function replaceModule(path: string, exports: unknown) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports } as NodeModule;
}
replaceModule("nodemailer", { __esModule: true, default: { createTransport: () => ({ sendMail: async (message: Record<string, unknown>) => {
  messages.push(message); if (smtpError) throw smtpError; return { accepted: ["customer@example.com"] };
} }) } });
replaceModule("../supabaseAdmin", { __esModule: true, default: {
  rpc: async () => ({ data: [{ id: "job", order_id: "order", claim_token: "token", attempts: 1 }], error: null }),
  from: (table: string) => {
    let updateStatus = "";
    const query = {
      select: (_fields: string) => query, eq: (_field: string, _value: unknown) => query,
      order: (_field: string) => query,
      update: (values: Record<string, unknown>) => { updates.push(values); updateStatus = String(values.status); return query; },
      single: async () => ({ data: { id: "order", order_number: 42, payment_status: "paid", customer_email: "customer@example.com", created_at: "2026-11-02T12:00:00Z", currency: "SEK", subtotal: 10000, shipping_cost: 0, total: 10000 }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
        data: table === "order_items" ? [{ product_name: "Koppel", quantity: 1, unit_price: 10000, customization: {} }] : null,
        error: recordError && updateStatus === "sent" ? { message: "Database down" } : null,
      })),
    }; return query;
  },
} });
const { sendNextOrderConfirmation } = require("../lib/orderConfirmationEmails") as typeof import("../lib/orderConfirmationEmails");

test("sender handles accepted, rejected and ambiguous SMTP outcomes without real mail", async (t) => {
  process.env.GMAIL_USER = "sender@example.com"; process.env.GMAIL_PASS = "test";
  await t.test("accepted email is recorded and includes both message formats", async () => {
    await sendNextOrderConfirmation();
    assert.equal(updates[0].status, "sent");
    assert.equal(messages[0].to, "customer@example.com");
    assert.ok(messages[0].text); assert.ok(messages[0].html);
  });
  await t.test("explicit SMTP rejection schedules a retry", async () => {
    updates = []; smtpError = { responseCode: 451, code: "EMESSAGE" };
    await sendNextOrderConfirmation(); assert.equal(updates[0].status, "retry");
  });
  await t.test("unknown delivery is not retried automatically", async () => {
    updates = []; smtpError = { code: "ETIMEDOUT" };
    await sendNextOrderConfirmation(); assert.equal(updates[0].status, "uncertain");
  });
  await t.test("accepted message followed by database failure is not resent", async () => {
    updates = []; smtpError = null; recordError = true;
    await sendNextOrderConfirmation(); assert.equal(updates[1].status, "uncertain");
  });
  await t.test("connection failure cannot have sent mail and preserves useful diagnostics", async () => {
    updates = []; recordError = false;
    smtpError = { code: "ESOCKET", command: "CONN", message: "unable to verify the first certificate" };
    await sendNextOrderConfirmation();
    assert.equal(updates[0].status, "retry");
    assert.match(String(updates[0].last_error), /certificate/);
  });
});
