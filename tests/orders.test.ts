import { test } from "node:test";
import assert from "node:assert/strict";
import express, { Request, Response, NextFunction } from "express";
import type { AddressInfo } from "node:net";

const id = "20000000-0000-4000-8000-000000000001";
let filters: [string, unknown][] = [];
let update: unknown = null;
let conflict = false;
let queryCount = 0;
let missing = false;
let dbError = false;
function replaceModule(path: string, exports: unknown) {
  const moduleId = require.resolve(path);
  require.cache[moduleId] = { id: moduleId, filename: moduleId, loaded: true, exports } as NodeModule;
}
replaceModule("../middleware/auth", { __esModule: true, default: (req: Request, res: Response, next: NextFunction) => {
  if (req.headers.authorization !== "Bearer admin-test") return res.sendStatus(401);
  next();
} });
replaceModule("../supabaseAdmin", { __esModule: true, default: {
  from: (table: string) => {
    queryCount++;
    const query = {
      select: (_fields: string, _options?: unknown) => query,
      order: (_field: string, _options?: unknown) => query,
      range: (start: number, end: number) => { filters.push(["range", [start, end]]); return query; },
      eq: (field: string, value: unknown) => { filters.push([field, value]); return query; },
      update: (values: unknown) => { update = values; return query; },
      maybeSingle: async () => ({
        data: conflict || missing ? null : { id, status: "processing", payment_status: "paid" },
        error: dbError ? { message: "database down" } : null,
      }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
        data: table === "orders" ? [{ id }] : [], count: 25,
        error: dbError ? { message: "database down" } : null,
      })),
    };
    return query;
  },
} });
const router = require("../routes/orders").default;

test("admin order access and status management", async (t) => {
  const app = express(); app.use(express.json()); app.use("/orders", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/orders`;
  const headers = { Authorization: "Bearer admin-test", "Content-Type": "application/json" };
  const patch = (body: unknown) => fetch(`${base}/${id}/status`, { method: "PATCH", headers, body: JSON.stringify(body) });
  try {
    await t.test("all routes reject unauthenticated requests before database access", async () => {
      const before = queryCount;
      for (const [path, method] of [["", "GET"], [`/${id}`, "GET"], [`/${id}/status`, "PATCH"]]) {
        assert.equal((await fetch(`${base}${path}`, { method })).status, 401);
      }
      assert.equal(queryCount, before);
    });
    await t.test("list is paginated, filtered and never cached", async () => {
      filters = [];
      const response = await fetch(`${base}?page=2&status=paid`, { headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await response.json()).total, 25);
      assert.ok(filters.some(([field, value]) => field === "status" && value === "paid"));
      assert.deepEqual(filters.find(([field]) => field === "range")?.[1], [20, 39]);
    });
    await t.test("invalid filters and IDs are rejected", async () => {
      assert.equal((await fetch(`${base}?status=unknown`, { headers })).status, 400);
      assert.equal((await fetch(`${base}?page=0`, { headers })).status, 400);
      assert.equal((await fetch(`${base}/bad-id`, { headers })).status, 400);
    });
    await t.test("details include items and payments; missing orders return 404", async () => {
      const response = await fetch(`${base}/${id}`, { headers });
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.deepEqual(data.items, []); assert.deepEqual(data.payments, []);
      missing = true;
      assert.equal((await fetch(`${base}/${id}`, { headers })).status, 404);
      missing = false;
    });
    await t.test("status updates guard paid status and the previously displayed state atomically", async () => {
      filters = [];
      assert.equal((await patch({ expectedStatus: "paid", status: "processing" })).status, 200);
      assert.deepEqual(update, { status: "processing" });
      assert.deepEqual(filters, [["id", id], ["status", "paid"], ["payment_status", "paid"]]);
    });
    await t.test("unpaid orders, reverse transitions and payment edits are rejected", async () => {
      for (const body of [
        { expectedStatus: "pending", status: "shipped" },
        { expectedStatus: "shipped", status: "processing" },
        { expectedStatus: "paid", status: "completed" },
        { expectedStatus: "paid", status: "processing", payment_status: "paid" },
      ]) assert.equal((await patch(body)).status, 400);
    });
    await t.test("stale state or non-paid payment returns conflict", async () => {
      conflict = true;
      assert.equal((await patch({ expectedStatus: "paid", status: "shipped" })).status, 409);
      conflict = false;
    });
    await t.test("database failure returns a controlled error", async () => {
      dbError = true;
      assert.equal((await fetch(base, { headers })).status, 500);
      dbError = false;
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
