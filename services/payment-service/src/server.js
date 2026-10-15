
require("dotenv").config();

const app = require("./app");
const connectDB = require("./config/db");
const { connectRabbitMQ } = require("./config/rabbitmq");

const PORT = process.env.PORT || 4003;

async function startServer() {
    try {
        // Connect to MongoDB first
        await connectDB();

        // Connect to RabbitMQ
        await connectRabbitMQ();

        // Start accepting HTTP requests
        app.listen(PORT, () => {
            console.log(`Payment Service listening on port ${PORT}`);
        });
    } catch (error) {
        console.error("Failed to start Payment Service:", error.message);
        process.exit(1);
    }
}

startServer();
