import supabaseAdmin from "../supabaseAdmin";
import { stripe } from "./stripe";
import { syncCheckoutStatus } from "./checkoutStatus";

// Recover missed webhooks and reservations left after a lost checkout response.
// Never release by local timestamp: Stripe must confirm payment or expiration.
export async function reconcileInventory() {
  let cursor: string | undefined;
  while (true) {
    let query = supabaseAdmin.from("orders")
      .select("id, stripe_checkout_session_id")
      .eq("inventory_status", "reserved")
      .order("id").limit(100);
    if (cursor) query = query.gt("id", cursor);
    const { data: orders, error } = await query;
    if (error) throw error;
    if (!orders?.length) return;
    for (const order of orders) {
      if (!order.stripe_checkout_session_id) continue;
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id, {
          expand: ["payment_intent"],
        });
        const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
        const failed = session.status === "complete" && session.payment_status !== "paid" &&
          (intent?.status === "canceled" || intent?.status === "requires_payment_method");
        if (session.payment_status === "paid" || session.status === "expired" || failed) {
          await syncCheckoutStatus(session, failed ? "failed" : undefined);
        }
      } catch (error) {
        console.error("Inventory reconciliation failed for order:", order.id, error);
      }
    }
    cursor = orders[orders.length - 1].id;
    if (orders.length < 100) return;
  }
}

export function startInventoryReconciliation() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await reconcileInventory();
    } catch (error) {
      console.error("Inventory reconciliation error:", error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 60_000);
  timer.unref();
  return timer;
}
