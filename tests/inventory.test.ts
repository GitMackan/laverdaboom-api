import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { availableProduct } from "../lib/inventory";

test("inventory transactions in isolated PostgreSQL", async (t) => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    for (const file of ["20261101190000_create_webshop.sql", "20261102120000_stripe_checkout.sql", "20261102150000_inventory_reservations.sql"]) {
      await db.exec(readFileSync(join(__dirname, "../supabase/migrations", file), "utf8"));
    }
    const product = (await db.query<{ id: string }>(`insert into public.products(name,slug,category,base_price,active)
      values ('Test','inventory-test','leash',10000,true) returning id`)).rows[0].id;
    const variant = async (stock: number, madeToOrder = false) => (await db.query<{ id: string }>(
      `insert into public.product_variants(product_id,price,stock_quantity,made_to_order)
       values ($1,10000,$2,$3) returning id`, [product, stock, madeToOrder])).rows[0].id;
    const order = async (items: { id: string; quantity: number }[]) => {
      const total = items.reduce((sum, item) => sum + item.quantity * 10000, 0);
      const id = (await db.query<{ id: string }>(`insert into public.orders(subtotal,total)
        values ($1,$1) returning id`, [total])).rows[0].id;
      await db.query("update public.orders set stripe_checkout_session_id = $2 where id = $1", [id, `cs_test_${id}`]);
      for (const item of items) await db.query(`insert into public.order_items(order_id,product_id,variant_id,product_name,quantity,unit_price)
        values ($1,$2,$3,'Test',$4,10000)`, [id, product, item.id, item.quantity]);
      return { id, total };
    };
    const reserve = (id: string) => db.query("select public.reserve_order_inventory($1)", [id]);
    const sync = (o: { id: string; total: number }, state: string) => db.query(
      "select public.sync_stripe_checkout($1,$2,$3,$4,$5,'sek','{}'::jsonb,'{}'::jsonb)",
      [o.id, `cs_test_${o.id}`, `pi_${o.id}`, state, o.total]);
    const stock = async (id: string) => (await db.query<{ stock_quantity: number; reserved_quantity: number }>(
      "select stock_quantity,reserved_quantity from public.product_variants where id = $1", [id])).rows[0];

    await t.test("last item is reserved once and another checkout cannot buy it", async () => {
      const v = await variant(1);
      const first = await order([{ id: v, quantity: 1 }]);
      const second = await order([{ id: v, quantity: 1 }]);
      // PGlite serializes these calls; PostgreSQL row locks serialize server transactions.
      const attempts = await Promise.allSettled([reserve(first.id), reserve(second.id)]);
      assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
      await reserve(first.id);
      assert.deepEqual(await stock(v), { stock_quantity: 1, reserved_quantity: 1 });
      await sync(first, "pending");
      assert.deepEqual(await stock(v), { stock_quantity: 1, reserved_quantity: 1 });
      await sync(first, "paid");
      await sync(first, "paid");
      await sync(first, "expired");
      assert.deepEqual(await stock(v), { stock_quantity: 0, reserved_quantity: 0 });
      const payments = await db.query("select * from public.payments where order_id = $1", [first.id]);
      assert.equal(payments.rows.length, 1);
    });
    await t.test("a failing basket rolls back all partial reservations", async () => {
      const a = await variant(2), b = await variant(0);
      const o = await order([{ id: a, quantity: 1 }, { id: b, quantity: 1 }]);
      await assert.rejects(reserve(o.id), /Otillräckligt lager/);
      assert.deepEqual(await stock(a), { stock_quantity: 2, reserved_quantity: 0 });
    });
    await t.test("expiration and async failure release once, and allow another order", async () => {
      for (const state of ["expired", "failed"]) {
        const v = await variant(2);
        const o = await order([{ id: v, quantity: 2 }]);
        await reserve(o.id);
        await sync(o, state);
        await sync(o, state);
        await sync(o, "pending");
        assert.deepEqual(await stock(v), { stock_quantity: 2, reserved_quantity: 0 });
        const next = await order([{ id: v, quantity: 2 }]);
        await reserve(next.id);
        await assert.rejects(sync(o, "paid"), /released inventory/);
      }
    });
    await t.test("made-to-order products never consume physical stock", async () => {
      const v = await variant(0, true);
      const o = await order([{ id: v, quantity: 5 }]);
      await reserve(o.id);
      await sync(o, "paid");
      assert.deepEqual(await stock(v), { stock_quantity: 0, reserved_quantity: 0 });
    });
    await t.test("changing made-to-order during checkout preserves the original reservation", async () => {
      const v = await variant(3);
      const o = await order([{ id: v, quantity: 2 }]);
      await reserve(o.id);
      await db.query("update public.product_variants set made_to_order = true where id = $1", [v]);
      await sync(o, "paid");
      assert.deepEqual(await stock(v), { stock_quantity: 1, reserved_quantity: 0 });
    });
    await t.test("admin cannot reduce stock below reserved quantity", async () => {
      const v = await variant(3);
      const o = await order([{ id: v, quantity: 2 }]);
      await reserve(o.id);
      await assert.rejects(db.query("update public.product_variants set stock_quantity = 1 where id = $1", [v]), /reservation_bounds/);
      await sync(o, "expired");
      await db.query("update public.product_variants set stock_quantity = 1 where id = $1", [v]);
    });
    await t.test("price changes and inactive variants cannot reserve", async () => {
      const v = await variant(2);
      const o = await order([{ id: v, quantity: 1 }]);
      await db.query("update public.product_variants set price = 20000 where id = $1", [v]);
      await assert.rejects(reserve(o.id), /Priset har ändrats/);
      await db.query("update public.product_variants set price = 10000, active = false where id = $1", [v]);
      await assert.rejects(reserve(o.id), /inte längre tillgänglig/);
      assert.deepEqual(await stock(v), { stock_quantity: 2, reserved_quantity: 0 });
    });
    await t.test("mismatched totals leave both stock and payment unchanged", async () => {
      const v = await variant(2);
      const o = await order([{ id: v, quantity: 1 }]);
      await reserve(o.id);
      await assert.rejects(sync({ ...o, total: 1 }, "paid"), /amount or currency mismatch/);
      assert.deepEqual(await stock(v), { stock_quantity: 2, reserved_quantity: 1 });
    });
    await t.test("old paid orders are not deducted retroactively", async () => {
      const v = await variant(2);
      const o = await order([{ id: v, quantity: 1 }]);
      await sync(o, "paid");
      assert.deepEqual(await stock(v), { stock_quantity: 2, reserved_quantity: 0 });
    });
    await t.test("reservation and payment functions are not callable by browser roles", async () => {
      const result = await db.query<{ allowed: boolean }>(`select has_function_privilege('anon',
        'public.reserve_order_inventory(uuid)', 'EXECUTE') as allowed`);
      assert.equal(result.rows[0].allowed, false);
    });
  } finally {
    await db.close();
  }
});

test("public inventory subtracts reservations without mutating admin data", () => {
  const original = { product_variants: [{ stock_quantity: 5, reserved_quantity: 3 }] };
  assert.equal(availableProduct(original).product_variants[0].stock_quantity, 2);
  assert.equal(original.product_variants[0].stock_quantity, 5);
});
