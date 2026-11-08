import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { orderConfirmationTemplate } from "../lib/orderConfirmationTemplate";
import type { Database } from "../types/supabase";

test("confirmation outbox follows paid transitions exactly once", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(readFileSync(join(__dirname, "../supabase/migrations/20261101190000_create_webshop.sql"), "utf8"));
    await db.exec(readFileSync(join(__dirname, "../supabase/migrations/20261102120000_stripe_checkout.sql"), "utf8"));
    // An existing paid order should never receive an unsolicited historical email.
    await db.exec("insert into public.orders(subtotal,total,payment_status) values (100,100,'paid');");
    await db.exec(readFileSync(join(__dirname, "../supabase/migrations/20261102180000_order_confirmation_emails.sql"), "utf8"));
    assert.equal((await db.query("select * from public.order_confirmation_emails")).rows.length, 0);
    const order = (await db.query<{id:string}>("insert into public.orders(subtotal,total) values (100,100) returning id")).rows[0];
    await db.query("update public.orders set payment_status = 'pending' where id = $1", [order.id]);
    assert.equal((await db.query("select * from public.order_confirmation_emails")).rows.length, 0);
    await db.query("update public.orders set payment_status = 'paid' where id = $1", [order.id]);
    await db.query("update public.orders set payment_status = 'paid' where id = $1", [order.id]);
    assert.equal((await db.query("select * from public.order_confirmation_emails")).rows.length, 1);
    const claims = await Promise.all([db.query("select * from public.claim_order_confirmation()"), db.query("select * from public.claim_order_confirmation()")]);
    assert.equal(claims.reduce((count, result) => count + result.rows.length, 0), 1);
    await db.exec("update public.order_confirmation_emails set claimed_at = now() - interval '11 minutes'");
    assert.equal((await db.query("select * from public.claim_order_confirmation()")).rows.length, 0);
    assert.equal((await db.query<{status:string}>("select status from public.order_confirmation_emails")).rows[0].status, "uncertain");
    // Explicit rejection can retry, unlike unknown delivery.
    await db.exec("update public.order_confirmation_emails set status = 'retry', next_attempt_at = now() - interval '1 minute'");
    assert.equal((await db.query("select * from public.claim_order_confirmation()")).rows.length, 1);
    await db.exec("update public.order_confirmation_emails set status = 'sent'");
    assert.equal((await db.query("select * from public.claim_order_confirmation()")).rows.length, 0);
    const permissions = await db.query<{allowed:boolean}>("select has_function_privilege('anon','public.claim_order_confirmation()','execute') as allowed");
    assert.equal(permissions.rows[0].allowed, false);
  } finally { await db.close(); }
});

test("confirmation template includes order details and escapes untrusted HTML", () => {
  const order = { order_number: 42, customer_name: '<script>alert("x")</script>', shipping_address: { line1: "Testvägen 1", postal_code: "12345", city: "Stockholm", country: "SE" }, created_at: "2026-11-02T12:00:00Z", currency: "SEK", subtotal: 20000, shipping_cost: 4900, total: 24900 } as unknown as Database["public"]["Tables"]["orders"]["Row"];
  const items = [{ product_name: "Koppel & halsband", quantity: 2, unit_price: 10000, customization: { variant_label: "Blå · 120 cm" } }] as unknown as Database["public"]["Tables"]["order_items"]["Row"][];
  const result = orderConfirmationTemplate(order, items, "support@example.com");
  assert.match(result.subject, /42/);
  for (const text of ["Koppel & halsband", "Blå · 120 cm", "Testvägen 1", "249", "support@example.com"]) assert.ok(result.text.includes(text));
  assert.ok(!result.html.includes("<script>"));
  assert.ok(result.html.includes("&lt;script&gt;"));
});
