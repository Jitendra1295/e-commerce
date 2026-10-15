
const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
    {
        orderId: {
            type: String,
            required: true,
            index: true,
        },
        userId: {
            type: String,
            required: true,
            index: true,
        },
        amountPaise: {
            type: Number,
            required: true,
            min: 1,
            validate: {
                validator: Number.isSafeInteger,
                message: "Amount must be a whole number of paise",
            },
        },
        currency: {
            type: String,
            default: "INR",
            enum: ["INR"],
        },
        status: {
            type: String,
            enum: ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED"],
            default: "PENDING",
        },
        provider: {
            type: String,
            enum: ["MOCK", "STRIPE"],
            default: "MOCK",
        },
        providerPaymentId: {
            type: String,
            default: null,
        },
        clientSecret: {
            type: String,
            default: null,
        },
        failureReason: {
            type: String,
            default: null,
        },
        idempotencyKey: {
            type: String,
            required: true,
            unique: true,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("Payment", paymentSchema);
