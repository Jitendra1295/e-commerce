
const amqp = require("amqplib");

let connection;
let channel;

async function connectRabbitMQ() {
    if (channel) {
        return channel;
    }

    const url = process.env.RABBITMQ_URL;

    if (!url) {
        throw new Error("RABBITMQ_URL is not configured");
    }

    connection = await amqp.connect(url);
    channel = await connection.createChannel();

    connection.on("error", (error) => {
        console.error("RabbitMQ connection error:", error.message);
    });

    connection.on("close", () => {
        console.error("RabbitMQ connection closed");
        connection = null;
        channel = null;
    });

    console.log("Order Service connected to RabbitMQ");

    return channel;
}

function getRabbitMQChannel() {
    if (!channel) {
        throw new Error("RabbitMQ channel is not initialized");
    }

    return channel;
}

module.exports = {
    connectRabbitMQ,
    getRabbitMQChannel,
};
