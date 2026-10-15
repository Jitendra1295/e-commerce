
require("dotenv").config();

const app = require("./app");
const pool = require("./config/db");
const { connectRabbitMQ } = require("./config/rabbitmq");
const { startPaymentConsumer } = require("./consumers/payment.consumer");

const PORT = process.env.PORT || 4002;

async function startServer() {
    try {
        // Verify PostgreSQL is reachable before starting.
        await pool.query("SELECT 1");
        console.log("Order Service connected to PostgreSQL");

        // Connect to RabbitMQ.
        await connectRabbitMQ();

        // Start consuming payment events.
        await startPaymentConsumer();

        // Start the HTTP server.
        app.listen(PORT, () => {
            console.log(`Order Service running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Order Service startup failed:", error.message);
        process.exit(1);
    }
}

startServer();
