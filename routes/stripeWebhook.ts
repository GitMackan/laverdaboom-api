import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { stripe } from "../lib/stripe";
import { syncCheckoutStatus } from "../lib/checkoutStatus";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || typeof signature !== "string" || !webhookSecret) {
        return res.status(400).send("Missing Stripe webhook signature or secret");
    }

    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            signature,
            webhookSecret
        );
    } catch (error) {
        console.error("Stripe webhook signature verification failed:", error);
        return res.status(400).send("Invalid webhook signature");
    }

    try {
        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object as Stripe.Checkout.Session;
                await syncCheckoutStatus(await stripe.checkout.sessions.retrieve(session.id));

                console.log("Checkout completed:", {
                    sessionId: session.id,
                    orderId: session.metadata?.order_id,
                    paymentStatus: session.payment_status,
                    amountTotal: session.amount_total,
                });

                break;
            }

            case "checkout.session.async_payment_succeeded": {
                await syncCheckoutStatus(await stripe.checkout.sessions.retrieve(event.data.object.id));
                console.log("Async payment succeeded:", event.data.object.id);
                break;
            }

            case "checkout.session.async_payment_failed": {
                await syncCheckoutStatus(await stripe.checkout.sessions.retrieve(event.data.object.id), "failed");
                console.log("Async payment failed:", event.data.object.id);
                break;
            }

            case "checkout.session.expired": {
                await syncCheckoutStatus(await stripe.checkout.sessions.retrieve(event.data.object.id), "expired");
                console.log("Checkout expired:", event.data.object.id);
                break;
            }

            default:
                console.log("Unhandled Stripe event:", event.type);
        }

        return res.sendStatus(200);
    } catch (error) {
        console.error("Stripe webhook processing failed:", error);
        return res.sendStatus(500);
    }
});

export default router;
