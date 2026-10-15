const express = require("express");
const {
    createPayment,
    getPaymentById,
    handleStripeWebhook,
} = require("../controllers/payment.controller");
const authenticateToken = require("../middleware/auth.middleware");

const router = express.Router();

/**
 * @openapi
 * /payments:
 *   post:
 *     summary: Create a payment (Stripe or Mock)
 *     description: Creates a Stripe PaymentIntent (or mock if Stripe key is not set). Returns clientSecret for frontend checkout.
 *     tags:
 *       - Payments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 8
 *           maxLength: 128
 *         description: Unique key for this payment request; reuse it when retrying the same request.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderId
 *             properties:
 *               orderId:
 *                 type: string
 *                 example: "4"
 *                 description: Order ID to pay for. Amount is verified directly from Order Service.
 *     responses:
 *       201:
 *         description: Pending payment created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Stripe payment intent created successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     orderId:
 *                       type: string
 *                       example: "4"
 *                     userId:
 *                       type: string
 *                     amountPaise:
 *                       type: integer
 *                       example: 159800
 *                     currency:
 *                       type: string
 *                       example: INR
 *                     status:
 *                       type: string
 *                       example: PENDING
 *                     provider:
 *                       type: string
 *                       example: STRIPE
 *                     providerPaymentId:
 *                       type: string
 *                       example: pi_3Pxyz123
 *                     clientSecret:
 *                       type: string
 *                       example: pi_3Pxyz123_secret_abc
 *                     idempotencyKey:
 *                       type: string
 *       200:
 *         description: Existing payment returned for a retry
 *       400:
 *         description: Invalid request or missing Idempotency-Key
 *       401:
 *         description: Missing or invalid JWT
 *       409:
 *         description: Idempotency key conflict
 *       500:
 *         description: Internal server error
 *       502:
 *         description: Stripe gateway error
 */
router.post("/", authenticateToken, createPayment);

/**
 * @openapi
 * /payments/{id}:
 *   get:
 *     summary: Get payment details by ID
 *     tags:
 *       - Payments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment record ID
 *     responses:
 *       200:
 *         description: Payment details retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Payment not found
 *       500:
 *         description: Internal server error
 */
router.get("/:id", authenticateToken, getPaymentById);

/**
 * @openapi
 * /payments/webhook:
 *   post:
 *     summary: Stripe Webhook handler
 *     description: Receives asynchronous events from Stripe (e.g., payment_intent.succeeded)
 *     tags:
 *       - Payments
 *     parameters:
 *       - in: header
 *         name: stripe-signature
 *         required: true
 *         schema:
 *           type: string
 *         description: Stripe webhook HMAC signature
 *     responses:
 *       200:
 *         description: Webhook received and verified
 *       400:
 *         description: Webhook signature verification error
 */
router.post("/webhook", handleStripeWebhook);

module.exports = router;
