import nodemailer from "nodemailer";
import supabaseAdmin from "../supabaseAdmin";
import { orderConfirmationTemplate } from "./orderConfirmationTemplate";
import { mailTlsOptions } from "./mailTls";

export async function sendNextOrderConfirmation() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) return false;
  const { data: jobs, error } = await supabaseAdmin.rpc("claim_order_confirmation");
  if (error) throw error;
  const job = jobs?.[0];
  if (!job) return false;
  if (!job.claim_token) throw new Error("Email claim token is missing");
  const claimToken = job.claim_token;
  let smtpStarted = false;
  let accepted = false;
  try {
    const { data: order, error: orderError } = await supabaseAdmin.from("orders").select("*").eq("id", job.order_id).single();
    if (orderError) throw orderError;
    if (!order || order.payment_status !== "paid" || !order.customer_email) throw new Error("Paid order or customer email is missing");
    const { data: items, error: itemsError } = await supabaseAdmin.from("order_items").select("*").eq("order_id", order.id).order("created_at").order("id");
    if (itemsError) throw itemsError;
    if (!items?.length) throw new Error("Order has no items");
    const sender = process.env.GMAIL_USER;
    const replyTo = process.env.ORDER_EMAIL_REPLY_TO || sender;
    const transporter = nodemailer.createTransport({
      service: "gmail", auth: { user: sender, pass: process.env.GMAIL_PASS },
      tls: mailTlsOptions(),
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    });
    smtpStarted = true;
    const result = await transporter.sendMail({
      from: { name: "LaverdaBoom", address: sender }, to: order.customer_email, replyTo,
      messageId: `<order-${order.id}@${sender.split("@")[1]}>`,
      ...orderConfirmationTemplate(order, items, replyTo),
    });
    accepted = result.accepted?.length > 0;
    if (!accepted) throw new Error("SMTP did not accept the recipient");
    const { error: saveError } = await supabaseAdmin.from("order_confirmation_emails")
      .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
      .eq("id", job.id).eq("claim_token", claimToken).eq("status", "sending");
    if (saveError) throw saveError;
  } catch (error) {
    const smtpError = error as { responseCode?: number; code?: string; command?: string; message?: string };
    // Only explicit rejection or a failure before SMTP is safe to retry.
    const definitelyRejected = !smtpStarted || (!accepted && (
      smtpError.command === "CONN" || smtpError.command === "AUTH" ||
      (typeof smtpError.responseCode === "number" && smtpError.responseCode >= 400)
    ));
    const status = definitelyRejected ? (job.attempts >= 5 ? "failed" : "retry") : "uncertain";
    let details = [smtpError.code, smtpError.command, smtpError.message].filter(Boolean).join(" · ") || "Email failed";
    if (process.env.GMAIL_PASS) details = details.split(process.env.GMAIL_PASS).join("[redacted]");
    details = details.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]").slice(0, 500);
    const { error: saveError } = await supabaseAdmin.from("order_confirmation_emails").update({
      status, last_error: accepted ? "SMTP accepted the message but delivery recording failed" : details,
      next_attempt_at: new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60_000).toISOString(),
    }).eq("id", job.id).eq("claim_token", claimToken).eq("status", "sending");
    if (saveError) throw saveError;
    console.error("Order confirmation email requires attention:", job.order_id, status, accepted ? "SMTP accepted; database update failed" : details);
  }
  return true;
}

export function startOrderConfirmationEmails() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
    console.warn("Order confirmation emails disabled: GMAIL_USER or GMAIL_PASS missing");
    return;
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { for (let count = 0; count < 10 && await sendNextOrderConfirmation(); count++) { /* Drain a bounded batch. */ } }
    catch (error) { console.error("Order confirmation queue error:", error); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), 15_000);
  timer.unref();
  return timer;
}
