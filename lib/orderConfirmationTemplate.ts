import { Database } from "../types/supabase";

type Order = Database["public"]["Tables"]["orders"]["Row"];
type Item = Database["public"]["Tables"]["order_items"]["Row"];
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
const money = (amount: number, currency: string) => new Intl.NumberFormat("sv-SE", { style: "currency", currency }).format(amount / 100);

export function orderConfirmationTemplate(order: Order, items: Item[], contactEmail: string) {
  const address = order.shipping_address && typeof order.shipping_address === "object" && !Array.isArray(order.shipping_address)
    ? order.shipping_address : {};
  const addressLines = [order.customer_name, address.line1, address.line2,
    [address.postal_code, address.city].filter(Boolean).join(" "), address.state,
    address.country === "SE" ? "Sverige" : address.country].filter((value): value is string => typeof value === "string" && !!value);
  const itemLines = items.map((item) => {
    const customization = item.customization && typeof item.customization === "object" && !Array.isArray(item.customization) ? item.customization : {};
    const variant = typeof customization.variant_label === "string" ? customization.variant_label : item.sku;
    return `${item.product_name}${variant ? ` (${variant})` : ""} — ${item.quantity} st × ${money(item.unit_price, order.currency)} = ${money(item.unit_price * item.quantity, order.currency)}`;
  });
  const date = new Intl.DateTimeFormat("sv-SE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Stockholm" }).format(new Date(order.created_at));
  const subject = `Orderbekräftelse #${order.order_number} – LaverdaBoom`;
  const lines = ["Tack för din beställning!", "", "Din betalning är bekräftad och vi har tagit emot din beställning.",
    `Ordernummer: ${order.order_number}`, `Beställningsdatum: ${date}`, "", "Din beställning", ...itemLines,
    "", `Produkter: ${money(order.subtotal, order.currency)}`, `Frakt: ${money(order.shipping_cost, order.currency)}`,
    `Totalt betalt: ${money(order.total, order.currency)}`, "", "Leveransadress", ...addressLines,
    "", `Frågor om din beställning? Kontakta ${contactEmail} och ange ditt ordernummer.`, "", "Vänliga hälsningar,", "LaverdaBoom"];
  const text = lines.join("\n");
  const html = `<div lang="sv" style="font-family:Arial,sans-serif;color:#222;max-width:640px;margin:auto;line-height:1.7;padding:24px"><h1 style="font-size:26px">Tack för din beställning!</h1>${lines.slice(2).map((line) => line ? `<p style="margin:8px 0">${escape(line)}</p>` : "<br>").join("")}</div>`;
  return { subject, text, html };
}
