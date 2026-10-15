const crypto = require("crypto");
const Payment = require("../models/payment.model");
const { getStripeClient } = require("../config/stripe");
const { publishPaymentEvent } = require("../events/payment.publisher");
async function createPayment(req, res) {
    const { orderId } = req.body || {};
    const userId = req.user && req.user.id;

    if (!userId) {
        return res.status(401).json({
            success: false,
            message: "Authentication required",
        });
    }

    if (typeof orderId !== "string" || !/^[1-9]\d*$/.test(orderId)) {
        return res.status(400).json({
            success: false,
            message: "Valid orderId is required",
        });
    }

    const idempotencyKey = req.get("Idempotency-Key");

    if (
        typeof idempotencyKey !== "string" ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 128
    ) {
        return res.status(400).json({
            success: false,
            message: "Provide an Idempotency-Key header (8–128 characters)",
        });
    }

    try {
        const orderServiceUrl =
            process.env.ORDER_SERVICE_URL || "http://localhost:4002";

        const orderResponse = await fetch(
            `${orderServiceUrl}/orders/${encodeURIComponent(orderId)}`,
            {
                method: "GET",
                headers: {
                    Authorization: req.headers.authorization,
                    Accept: "application/json",
                },
            }
        );

        const orderResult = await orderResponse.json();

        if (orderResponse.status === 401) {
            return res.status(401).json({
                success: false,
                message: "Authentication failed. Please log in again.",
            });
        }

        if (orderResponse.status === 404) {
            return res.status(404).json({
                success: false,
                message: "Order not found or does not belong to you.",
            });
        }

        if (!orderResponse.ok || !orderResult.success || !orderResult.data) {
            return res.status(502).json({
                success: false,
                message: "Could not verify the order. Please try again.",
            });
        }

        const order = orderResult.data;

        if (order.status !== "PENDING") {
            return res.status(409).json({
                success: false,
                message: "Only pending orders can be paid.",
            });
        }

        // Convert the trusted total from rupees to paise.
        const amountMatch = String(order.total_amount).match(
            /^(\d+)(?:\.(\d{1,2}))?$/
        );

        if (!amountMatch) {
            return res.status(500).json({
                success: false,
                message: "Invalid order amount.",
            });
        }

        const amountPaise =
            Number(amountMatch[1]) * 100 +
            Number((amountMatch[2] || "").padEnd(2, "0"));

        if (!Number.isSafeInteger(amountPaise) || amountPaise < 1) {
            return res.status(500).json({
                success: false,
                message: "Invalid order amount.",
            });
        }

        // Use the authenticated identity and verified order details.
        if (String(order.user_id) !== String(userId)) {
            return res.status(403).json({
                success: false,
                message: "You cannot pay for this order.",
            });
        }

        const existingPayment = await Payment.findOne({ idempotencyKey });

        if (existingPayment) {
            if (
                existingPayment.userId !== userId ||
                existingPayment.orderId !== orderId ||
                existingPayment.amountPaise !== amountPaise
            ) {
                return res.status(409).json({
                    success: false,
                    message: "Idempotency key was already used for a different request",
                });
            }

            return res.status(200).json({
                success: true,
                message: "Existing payment returned",
                data: existingPayment,
            });
        }

        const stripe = getStripeClient();
        let provider = "MOCK";
        let providerPaymentId = `mock_${crypto.randomUUID()}`;
        let clientSecret = null;
        let status = "PENDING";

        if (stripe) {
            try {
                console.log(
                    `[PAYMENT] 🚀 Creating Stripe PaymentIntent for Order #${orderId} (${amountPaise / 100} INR)...`
                );

                const paymentIntent = await stripe.paymentIntents.create(
                    {
                        amount: amountPaise,
                        currency: "inr",
                        metadata: {
                            orderId,
                            userId,
                        },
                        automatic_payment_methods: {
                            enabled: true,
                        },
                    },
                    {
                        idempotencyKey: `stripe_${idempotencyKey}`,
                    }
                );

                provider = "STRIPE";
                providerPaymentId = paymentIntent.id;
                clientSecret = paymentIntent.client_secret;
                status =
                    paymentIntent.status === "succeeded"
                        ? "SUCCEEDED"
                        : "PENDING";

                console.log(
                    `[PAYMENT] ✅ Stripe PaymentIntent created: ${paymentIntent.id} (Status: ${paymentIntent.status})`
                );
            } catch (stripeError) {
                console.error(
                    `[PAYMENT] ❌ Stripe PaymentIntent creation failed:`,
                    stripeError.message
                );

                return res.status(502).json({
                    success: false,
                    message: `Stripe error: ${stripeError.message}`,
                });
            }
        } else {
            console.log(
                `[PAYMENT] ℹ️ Using MOCK provider for Order #${orderId} (Stripe not configured)`
            );
        }

        const payment = await Payment.create({
            orderId,
            userId,
            amountPaise,
            currency: "INR",
            status,
            provider,
            providerPaymentId,
            clientSecret,
            idempotencyKey,
        });

        console.log(
            `[PAYMENT] 💾 Payment record saved to DB (ID: ${payment._id}, Order: ${orderId}, Status: ${status})`
        );

        return res.status(201).json({
            success: true,
            message:
                provider === "STRIPE"
                    ? "Stripe payment intent created successfully"
                    : "Payment created; payment is pending (MOCK)",
            data: payment,
        });
    } catch (error) {
        if (error.code === 11000) {
            const existingPayment = await Payment.findOne({ idempotencyKey });

            if (existingPayment && existingPayment.userId === userId) {
                return res.status(200).json({
                    success: true,
                    message: "Existing payment returned",
                    data: existingPayment,
                });
            }

            return res.status(409).json({
                success: false,
                message: "Idempotency key conflict",
            });
        }

        console.error("Failed to create payment:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to create payment",
        });
    }
}

async function getPaymentById(req, res) {
    const { id } = req.params;
    const userId = req.user && req.user.id;

    if (!userId) {
        return res.status(401).json({
            success: false,
            message: "Authentication required",
        });
    }

    try {
        const payment = await Payment.findOne({ _id: id, userId });

        if (!payment) {
            return res.status(404).json({
                success: false,
                message: "Payment not found",
            });
        }

        return res.status(200).json({
            success: true,
            data: payment,
        });
    } catch (error) {
        console.error("Failed to fetch payment:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch payment",
        });
    }
}

async function handleStripeWebhook(req, res) {
    const stripe = getStripeClient();
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripe || !webhookSecret || webhookSecret.includes("replace_with_your")) {
        console.warn("[STRIPE WEBHOOK] ⚠️ STRIPE_WEBHOOK_SECRET is not configured");
        return res.status(400).json({
            success: false,
            message: "Stripe webhook secret is not configured",
        });
    }

    let event;

    try {
        const payload = req.rawBody || req.body;
        event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
    } catch (err) {
        console.error(`[STRIPE WEBHOOK] ❌ Signature verification failed:`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`\n================== [STRIPE WEBHOOK EVENT] ==================`);
    console.log(`📡 Event Received: ${event.type} (ID: ${event.id})`);

    switch (event.type) {

        case "payment_intent.succeeded": {
            const paymentIntent = event.data.object;

            const existing = await Payment.findOne({
                providerPaymentId: paymentIntent.id,
            });

            if (!existing) {
                console.error("No payment record found for:", paymentIntent.id);
                return res.status(500).json({
                    success: false,
                    message: "Payment record not found",
                });
            }

            // Verify the webhook matches the payment we created.
            const receivedAmount =
                paymentIntent.amount_received || paymentIntent.amount;

            if (
                receivedAmount !== existing.amountPaise ||
                paymentIntent.currency.toUpperCase() !==
                existing.currency.toLowerCase().toUpperCase() ||
                String(paymentIntent.metadata?.orderId) !== existing.orderId ||
                String(paymentIntent.metadata?.userId) !== existing.userId
            ) {
                console.error("Stripe payment details do not match our record");

                return res.status(400).json({
                    success: false,
                    message: "Payment details mismatch",
                });
            }

            const updated = await Payment.findOneAndUpdate(
                { _id: existing._id },
                { status: "SUCCEEDED", failureReason: null },
                { returnDocument: "after" }
            );

            // Publish only after the payment record is updated.
            await publishPaymentEvent("succeeded", updated, event.id);

            console.log("Payment succeeded and event published:", {
                orderId: updated.orderId,
                paymentIntentId: paymentIntent.id,
                stripeEventId: event.id,
            });

            break;
        }

        case "payment_intent.payment_failed": {
            const paymentIntent = event.data.object;

            const existing = await Payment.findOne({
                providerPaymentId: paymentIntent.id,
            });

            if (!existing) {
                console.error("No payment record found for:", paymentIntent.id);
                return res.status(500).json({
                    success: false,
                    message: "Payment record not found",
                });
            }

            if (
                paymentIntent.amount !== existing.amountPaise ||
                paymentIntent.currency.toUpperCase() !==
                existing.currency.toUpperCase() ||
                String(paymentIntent.metadata?.orderId) !== existing.orderId ||
                String(paymentIntent.metadata?.userId) !== existing.userId
            ) {
                console.error("Stripe payment details do not match our record");

                return res.status(400).json({
                    success: false,
                    message: "Payment details mismatch",
                });
            }

            const lastError = paymentIntent.last_payment_error;

            const failureReason =
                lastError?.message ||
                lastError?.decline_code ||
                lastError?.code ||
                "Payment attempt failed";

            const updated = await Payment.findOneAndUpdate(
                { _id: existing._id },
                { status: "FAILED", failureReason },
                { returnDocument: "after" }
            );

            await publishPaymentEvent("failed", updated, event.id);

            console.log("Payment failure event published:", {
                orderId: updated.orderId,
                paymentIntentId: paymentIntent.id,
                stripeEventId: event.id,
            });

            break;
        }

        case "payment_intent.canceled": {
            const paymentIntent = event.data.object;
            await Payment.findOneAndUpdate(
                { providerPaymentId: paymentIntent.id },
                { status: "CANCELLED", failureReason: "Payment canceled by user or system" }
            );
            console.log(`⚠️ [PAYMENT CANCELED] Intent: ${paymentIntent.id}`);
            break;
        }

        default:
            console.log(`ℹ️ [STRIPE INFO] Event type: ${event.type} processed`);
    }
    console.log(`============================================================\n`);

    return res.status(200).json({ received: true });
}

module.exports = {
    createPayment,
    getPaymentById,
    handleStripeWebhook,
};
