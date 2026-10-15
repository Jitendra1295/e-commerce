
const mongoose = require("mongoose");

async function connectDB() {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
        throw new Error("MONGODB_URI is missing from .env");
    }

    await mongoose.connect(mongoUri);

    console.log("Payment Service connected to MongoDB");
}

module.exports = connectDB;
