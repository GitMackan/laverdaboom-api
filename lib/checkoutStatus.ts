import Stripe from "stripe";
import supabaseAdmin from "../supabaseAdmin";

export async function syncCheckoutStatus(
  session: Stripe.Checkout.Session,
  failure?: "failed" | "expired",
) {
  const orderId = session.metadata?.order_id;
  if (!orderId) throw new Error("Checkout has no order ID");
  const state = session.payment_status === "paid" ? "paid"
    : session.status === "expired" ? "expired" : failure ?? "pending";
  const { error } = await supabaseAdmin.rpc("sync_stripe_checkout", {
    p_order_id: orderId,
    p_session_id: session.id,
    p_payment_id: typeof session.payment_intent === "string"
      ? session.payment_intent : session.payment_intent?.id ?? session.id,
    p_state: state,
    p_total: session.amount_total ?? -1,
    p_currency: session.currency ?? "",
    p_customer: JSON.parse(JSON.stringify(session.customer_details ?? {})),
    p_shipping: JSON.parse(JSON.stringify(session.collected_information?.shipping_details ?? {})),
  });
  if (error) throw error;
}
