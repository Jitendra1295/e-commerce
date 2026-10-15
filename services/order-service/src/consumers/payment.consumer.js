
const { getRabbitMQChannel } = require("../config/rabbitmq");
const pool = require("../config/db");

const EXCHANGE_NAME = "ecommerce.events";
const QUEUE_NAME = "order.payment-events";

function toPaise(amount) {
    const value = String(amount);

    if (!/^\d+(\.\d{1,2})?$/.test(value)) {
        throw new Error("Invalid order amount");
    }

    const [rupees, fraction = ""] = value.split(".");
    return BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, "0"));
}

async function processPaymentEvent(event) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Store processed event IDs to prevent duplicate processing.
        const inserted = await client.query(
            `INSERT INTO processed_payment_events (event_id, event_type, order_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
            [event.eventId, event.eventType, String(event.data.orderId)]
        );

        if (inserted.rowCount === 0) {
            await client.query("COMMIT");
            console.log("Duplicate payment event ignored:", event.eventId);
            return;
        }

        // Failed payments are recorded, but do not confirm the order.
        if (event.eventType === "payment.failed") {
            await client.query("COMMIT");
            console.log("Payment failed; order remains unchanged:", event.data.orderId);
            return;
        }

        const { orderId, userId, amountPaise } = event.data;

        const result = await client.query(
            `SELECT id, user_id, status, total_amount
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
            [orderId]
        );

        if (result.rowCount === 0) {
            throw new Error("Order not found");
        }

        const order = result.rows[0];

        // Ensure this payment belongs to the correct order owner.
        if (String(order.user_id) !== String(userId)) {
            throw new Error("Payment user does not match order owner");
        }

        if (
            !Number.isSafeInteger(amountPaise) ||
            amountPaise <= 0 ||
            toPaise(order.total_amount) !== BigInt(amountPaise)
        ) {
            throw new Error("Payment amount does not match order total");
        }

        if (order.status === "PENDING") {
            await client.query(
                `UPDATE orders
         SET status = 'CONFIRMED'
         WHERE id = $1 AND status = 'PENDING'`,
                [orderId]
            );

            console.log("Order confirmed after payment:", orderId);
        } else {
            console.log("Order not pending; status unchanged:", {
                orderId,
                status: order.status,
            });
        }

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function startPaymentConsumer() {
    const channel = getRabbitMQChannel();

    await channel.assertExchange(EXCHANGE_NAME, "topic", {
        durable: true,
    });

    await channel.assertQueue(QUEUE_NAME, {
        durable: true,
    });

    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, "payment.*");
    await channel.prefetch(1);

    // Create the event deduplication table if it does not exist.
    await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_payment_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      order_id TEXT NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

    await channel.consume(QUEUE_NAME, async (message) => {
        if (!message) return;

        let event;

        // Invalid messages should not be requeued forever.
        try {
            event = JSON.parse(message.content.toString());

            if (
                !event.eventId ||
                !["payment.succeeded", "payment.failed"].includes(event.eventType) ||
                !event.data?.orderId ||
                !event.data?.userId
            ) {
                throw new Error("Invalid payment event structure");
            }

            if (
                event.eventType === "payment.succeeded" &&
                !Number.isSafeInteger(event.data.amountPaise)
            ) {
                throw new Error("Invalid payment amount");
            }
        } catch (error) {
            console.error("Discarding invalid payment event:", error.message);
            channel.nack(message, false, false);
            return;
        }

        try {
            await processPaymentEvent(event);
            channel.ack(message);
        } catch (error) {
            console.error("Payment event processing failed:", error.message);

            // Requeue for now; bounded retries and a dead-letter queue
            // are needed before production use.
            channel.nack(message, false, true);
        }
    });

    console.log("Order Service listening for payment events");
}

module.exports = { startPaymentConsumer };
