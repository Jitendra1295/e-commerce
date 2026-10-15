
const { getRabbitMQChannel } = require("../config/rabbitmq");

const EXCHANGE_NAME = "ecommerce.events";

async function publishPaymentEvent(eventType, payment, stripeEventId) {
    const channel = getRabbitMQChannel();

    // Create a durable exchange if it doesn't exist
    await channel.assertExchange(EXCHANGE_NAME, "topic", {
        durable: true,
    });

    const routingKey = `payment.${eventType}`;

    const event = {
        eventId: stripeEventId || `${payment.providerPaymentId}:${eventType}`,
        eventType: routingKey,
        occurredAt: new Date().toISOString(),
        data: {
            orderId: payment.orderId,
            userId: payment.userId,
            amountPaise: payment.amountPaise,
            currency: payment.currency,
            providerPaymentId: payment.providerPaymentId,
        },
    };

    const message = Buffer.from(JSON.stringify(event));

    channel.publish(EXCHANGE_NAME, routingKey, message, {
        persistent: true,
        contentType: "application/json",
    });

    console.log(`Published event: ${routingKey}`, {
        orderId: payment.orderId,
    });

    return event;
}

module.exports = { publishPaymentEvent };
