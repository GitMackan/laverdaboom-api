import { Router } from "express";
import { z } from "zod";
import requireAuth from "../middleware/auth";
import supabaseAdmin from "../supabaseAdmin";

const router = Router();
router.use(requireAuth);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const statuses = ["pending", "paid", "processing", "shipped", "completed", "cancelled"] as const;
const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  status: z.enum(statuses).optional(),
});

router.get("/", async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Ogiltigt filter eller sidnummer." });
  try {
    const { page, status } = parsed.data;
    let query = supabaseAdmin.from("orders")
      .select("id, order_number, created_at, customer_name, customer_email, status, payment_status, total, currency", { count: "exact" })
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range((page - 1) * 20, page * 20 - 1);
    if (status) query = query.eq("status", status);
    const { data, error, count } = await query;
    if (error) throw error;
    return res.json({ orders: data, total: count ?? 0, page, pageSize: 20 });
  } catch (error) {
    console.error("List orders error:", error);
    return res.status(500).json({ error: "Kunde inte hämta beställningarna." });
  }
});

router.get("/:id", async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: "Ogiltigt order-ID." });
  try {
    const { data: order, error } = await supabaseAdmin.from("orders").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!order) return res.status(404).json({ error: "Beställningen hittades inte." });
    const [items, payments, confirmation] = await Promise.all([
      supabaseAdmin.from("order_items").select("*, product_variants(color, length_cm, size)").eq("order_id", order.id).order("created_at").order("id"),
      supabaseAdmin.from("payments").select("*").eq("order_id", order.id).order("created_at", { ascending: false }),
      supabaseAdmin.from("order_confirmation_emails").select("status, attempts, sent_at, last_error").eq("order_id", order.id).maybeSingle(),
    ]);
    if (items.error) throw items.error;
    if (payments.error) throw payments.error;
    if (confirmation.error) throw confirmation.error;
    return res.json({ ...order, items: items.data, payments: payments.data, confirmation_email: confirmation.data });
  } catch (error) {
    console.error("Order details error:", error);
    return res.status(500).json({ error: "Kunde inte hämta beställningen." });
  }
});

const updateSchema = z.object({
  expectedStatus: z.enum(["paid", "processing", "shipped"]),
  status: z.enum(["processing", "shipped", "completed"]),
}).strict();
const transitions: Record<string, string[]> = {
  paid: ["processing", "shipped"], processing: ["shipped"], shipped: ["completed"],
};

router.patch("/:id/status", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!z.string().uuid().safeParse(req.params.id).success || !parsed.success) {
    return res.status(400).json({ error: "Ogiltig statusändring." });
  }
  const { expectedStatus, status } = parsed.data;
  if (!transitions[expectedStatus].includes(status)) return res.status(400).json({ error: "Den statusändringen är inte tillåten." });
  try {
    // Atomic guard: do not ship unpaid/refunded orders or overwrite another admin update.
    const { data, error } = await supabaseAdmin.from("orders").update({ status })
      .eq("id", req.params.id).eq("status", expectedStatus).eq("payment_status", "paid")
      .select("id, status, payment_status").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ error: "Ordern har ändrats eller är inte betald. Uppdatera sidan innan du fortsätter." });
    return res.json(data);
  } catch (error) {
    console.error("Update order status error:", error);
    return res.status(500).json({ error: "Kunde inte uppdatera orderstatus." });
  }
});

export default router;
