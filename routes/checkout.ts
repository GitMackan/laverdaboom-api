
import { Router } from "express";
import { z } from "zod";
import { stripe } from "../lib/stripe";
import supabaseAdmin from "../supabaseAdmin";
import { syncCheckoutStatus } from "../lib/checkoutStatus";

const router = Router();

// Expire at Stripe before releasing anything: a customer may still have the
// payment page open in another tab. Repeated requests are safe.
router.post("/session/:sessionId/cancel", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(req.params.sessionId)) {
    return res.status(400).json({ error: "Ogiltig betalningsreferens." });
  }
  try {
    let session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    const { data: order, error } = await supabaseAdmin.from("orders")
      .select("id").eq("stripe_checkout_session_id", session.id).single();
    if (error || !order) return res.status(404).json({ error: "Ordern hittades inte." });
    if (session.status === "open") {
      try {
        session = await stripe.checkout.sessions.expire(session.id);
      } catch {
        // Payment might have completed while the cancellation was in flight.
        session = await stripe.checkout.sessions.retrieve(session.id);
        if (session.status === "open") throw new Error("Checkout could not be expired");
      }
    }
    await syncCheckoutStatus(session);
    return res.json({ paymentStatus: session.payment_status, expired: session.status === "expired" });
  } catch (error) {
    console.error("Checkout cancellation error:", error);
    return res.status(503).json({ error: "Kunde inte avsluta kassan. Reservationen släpps när kassan löper ut." });
  }
});

// The unguessable Stripe session ID is the guest's receipt token. Return no PII.
router.get("/session/:sessionId", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(req.params.sessionId)) {
    return res.status(400).json({ error: "Ogiltig betalningsreferens." });
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    const { data: order, error } = await supabaseAdmin.from("orders")
      .select("order_number, payment_status, total, currency")
      .eq("stripe_checkout_session_id", session.id).single();
    if (error || !order) return res.status(404).json({ error: "Ordern hittades inte." });
    if (session.payment_status === "paid" || session.status === "expired") await syncCheckoutStatus(session);
    return res.json({
      orderNumber: order.order_number,
      paymentStatus: session.payment_status === "paid" ? "paid" : order.payment_status,
      expired: session.status === "expired",
      total: order.total,
      currency: order.currency,
    });
  } catch (error) {
    console.error("Checkout status error:", error);
    return res.status(503).json({ error: "Kunde inte hämta betalningsstatus. Försök igen." });
  }
});

const checkoutSchema = z.object({
  items: z.array(
    z.object({
      variantId: z.string().uuid(),
      quantity: z.number().int().min(1).max(99),
    })
  ).min(1).max(50),
});

router.post("/session", async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Ogiltig varukorg.",
    });
  }

  try {
    const items = parsed.data.items;

    // Slå ihop eventuella dubbla variant-ID:n.
    const quantities = new Map<string, number>();

    for (const item of items) {
      quantities.set(
        item.variantId,
        (quantities.get(item.variantId) ?? 0) +
          item.quantity
      );
    }

    const variantIds = [...quantities.keys()];

   const { data: variants, error } = await supabaseAdmin
  .from("product_variants")
  .select(`
    id,
    product_id,
    sku,
    color,
    length_cm,
    size,
    price,
    stock_quantity,
    reserved_quantity,
    made_to_order,
    active,
    products (
      id,
      name,
      active
    )
  `)
  .in("id", variantIds);

    if (error) {
      throw error;
    }

    if (!variants || variants.length !== variantIds.length) {
      return res.status(400).json({
        error: "En eller flera varianter finns inte.",
      });
    }

    
const lineItems: {
  price_data: {
    currency: string;
    unit_amount: number;
    product_data: {
      name: string;
      metadata: { variant_id: string };
    };
  };
  quantity: number;
}[] = [];

const orderItems: {
  product_id: string;
  variant_id: string;
  product_name: string;
  sku: string | null;
  quantity: number;
  unit_price: number;
  customization: { variant_label: string };
}[] = [];

for (const variant of variants) {
  const quantity = quantities.get(variant.id)!;

  const product = variant.products as unknown as {
    id: string;
    name: string;
    active: boolean;
  } | null;

  if (!variant.active || !product?.active) {
    return res.status(400).json({
      error: "En produkt är inte längre tillgänglig.",
    });
  }

  if (
    quantity > 99 ||
    (!variant.made_to_order &&
      variant.stock_quantity - variant.reserved_quantity < quantity)
  ) {
    const availableQuantity = variant.made_to_order ? 99 : Math.max(0, variant.stock_quantity - variant.reserved_quantity);
    return res.status(409).json({
      error: availableQuantity > 0
        ? `Endast ${availableQuantity} st av ${product.name} finns tillgängliga just nu. Minska antalet i varukorgen.`
        : `${product.name} är slut i lager eller tillfälligt reserverad. Ta bort produkten för att fortsätta.`,
      variantId: variant.id,
      availableQuantity,
    });
  }

  if (
    !Number.isSafeInteger(variant.price) ||
    variant.price <= 0
  ) {
    return res.status(400).json({
      error: "Ogiltigt produktpris.",
    });
  }

  lineItems.push({
    price_data: {
      currency: "sek",
      unit_amount: variant.price,
      product_data: {
        name: product.name,
        metadata: {
          variant_id: variant.id,
        },
      },
    },
    quantity,
  });

 orderItems.push({
  product_id: product.id,
  variant_id: variant.id,
  product_name: product.name,
  sku: variant.sku,
  quantity,
  unit_price: variant.price,
  customization: { variant_label: [variant.color, variant.length_cm !== null && variant.length_cm !== undefined ? `${variant.length_cm} cm` : null, variant.size].filter(Boolean).join(" · ") || "Standard" },
});
}


const frontendURL = process.env.FRONTEND_URL;

if (!frontendURL) {
  throw new Error("FRONTEND_URL is missing");
}

const subtotal = orderItems.reduce(
  (sum, item) => sum + item.unit_price * item.quantity,
  0
);

// Tillfälligt 0 kr tills vi konfigurerar frakten.
const shippingCost = 0;
const total = subtotal + shippingCost;

// 1. Skapa en obetald order.
const { data: order, error: orderError } = await supabaseAdmin
  .from("orders")
  .insert({
    status: "pending",
    payment_status: "unpaid",
    currency: "SEK",
    subtotal,
    shipping_cost: shippingCost,
    total,
  })
  .select("id, order_number")
  .single();

if (orderError || !order) {
  throw orderError ?? new Error("Could not create order");
}

// 2. Spara orderraderna.
const { error: itemsError } = await supabaseAdmin
  .from("order_items")
  .insert(
    orderItems.map((item) => ({
      ...item,
      order_id: order.id,
    }))
  );

if (itemsError) {
  await supabaseAdmin.from("orders").delete().eq("id", order.id);
  throw itemsError;
}

// 3. Skapa Stripe-sessionen.
let session;

try {
  session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: lineItems,
      locale: "sv",
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,

      shipping_address_collection: {
        allowed_countries: ["SE"],
      },

      phone_number_collection: {
        enabled: true,
      },

      metadata: {
        order_id: order.id,
      },

      client_reference_id: order.id,

      success_url:
        `${frontendURL}/shop/success?session_id={CHECKOUT_SESSION_ID}`,

      cancel_url: `${frontendURL}/shop/cart?cancelled=1`,
    },
    {
      idempotencyKey: `checkout-order-${order.id}`,
    }
  );
} catch (error) {
  await supabaseAdmin.from("orders").update({ status: "cancelled", payment_status: "failed" }).eq("id", order.id);
  console.error("Stripe session creation failed:", error);
  throw error;
}

// 4. Koppla Stripe-sessionen till ordern.
const { error: updateError } = await supabaseAdmin
  .from("orders")
  .update({
    stripe_checkout_session_id: session.id,
  })
  .eq("id", order.id);

if (updateError) {
  try {
    await stripe.checkout.sessions.expire(session.id);
  } catch (expireError) {
    console.error(
      "Could not expire Stripe session:",
      expireError
    );
  }

  await supabaseAdmin.from("orders").update({ status: "cancelled", payment_status: "failed" }).eq("id", order.id);

  throw updateError;
}

// The session exists and is linked before inventory is reserved. If creation
// times out or the process stops earlier, no stock is left stranded. The URL
// is only returned after all variants have been reserved in one transaction.
const { error: reservationError } = await supabaseAdmin.rpc("reserve_order_inventory", {
  p_order_id: order.id,
});
if (reservationError) {
  try {
    const expired = await stripe.checkout.sessions.expire(session.id);
    await syncCheckoutStatus(expired);
  } catch (cleanupError) {
    console.error("Could not close unreserved checkout:", cleanupError);
  }
  if (reservationError.code === "P0001") {
    return res.status(409).json({ error: reservationError.message });
  }
  throw reservationError;
}

return res.json({
  url: session.url,
  sessionId: session.id,
});

  } catch (error) {
    console.error("Checkout session error:", error);

    return res.status(500).json({
      error: "Kunde inte starta betalningen.",
    });
  }
});

export default router;
