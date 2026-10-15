
const express = require("express");
const pool = require("../config/db");

const router = express.Router();

/**
 * @openapi
 * /orders:
 *   post:
 *     summary: Create a new order
 *     tags:
 *       - Orders
 *     security:
 *       - bearerAuth: []
 *     description: Creates an order using current product prices and available stock. User ID is extracted from the JWT token.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required:
 *                     - productId
 *                     - quantity
 *                   properties:
 *                     productId:
 *                       type: integer
 *                       example: 1
 *                     quantity:
 *                       type: integer
 *                       minimum: 1
 *                       example: 2
 *     responses:
 *       201:
 *         description: Order created successfully
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
 *                   example: Order created; payment is pending
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 1
 *                     user_id:
 *                       type: string
 *                       example: 6acf41993eff279eb2272219
 *                     status:
 *                       type: string
 *                       example: PENDING
 *                     total_amount:
 *                       type: string
 *                       example: "59.98"
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           productId:
 *                             type: integer
 *                             example: 1
 *                           quantity:
 *                             type: integer
 *                             example: 2
 *                           unitPrice:
 *                             type: string
 *                             example: "29.99"
 *       400:
 *         description: Invalid request or insufficient stock
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Insufficient stock for Wireless Mouse
 *       401:
 *         description: Unauthorized or missing access token
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to create order
 */
router.post("/", async (req, res) => {
    const { items } = req.body || {};
    const userId = req.user && req.user.id;

    if (typeof userId !== "string" || !userId.trim()) {
        return res.status(401).json({
            success: false,
            message: "Authentication required",
        });
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
            success: false,
            message: "A non-empty items array is required",
        });
    }

    for (const item of items) {
        if (
            !Number.isSafeInteger(item.productId) ||
            item.productId < 1 ||
            !Number.isSafeInteger(item.quantity) ||
            item.quantity < 1
        ) {
            return res.status(400).json({
                success: false,
                message: "Each item needs a valid productId and positive quantity",
            });
        }
    }

    let client;

    try {
        client = await pool.connect();
        await client.query("BEGIN");

        // Combine repeated product IDs to avoid double-counting stock.
        const quantities = new Map();

        for (const item of items) {
            const total = (quantities.get(item.productId) || 0) + item.quantity;

            if (!Number.isSafeInteger(total)) {
                await client.query("ROLLBACK");
                return res.status(400).json({
                    success: false,
                    message: "Requested quantity is too large",
                });
            }

            quantities.set(item.productId, total);
        }

        const orderItems = [];

        for (const [productId, quantity] of quantities) {
            const productResult = await client.query(
                `SELECT id, name, price, stock
         FROM products
         WHERE id = $1
         FOR UPDATE`,
                [productId]
            );

            if (productResult.rows.length === 0) {
                await client.query("ROLLBACK");
                return res.status(400).json({
                    success: false,
                    message: `Product ${productId} does not exist`,
                });
            }

            const product = productResult.rows[0];

            if (product.stock < quantity) {
                await client.query("ROLLBACK");
                return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for ${product.name}`,
                });
            }

            orderItems.push({
                productId: product.id,
                quantity,
                unitPrice: product.price,
            });
        }

        // Calculate total using prices retrieved from the database.
        const totalAmount = orderItems.reduce(
            (total, item) =>
                total + Number(item.unitPrice) * item.quantity,
            0
        );

        if (!Number.isFinite(totalAmount)) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                success: false,
                message: "Invalid order total",
            });
        }

        const orderResult = await client.query(
            `INSERT INTO orders (user_id, status, total_amount)
       VALUES ($1, 'PENDING', $2)
       RETURNING id, user_id, status, total_amount, created_at`,
            [userId.trim(), totalAmount.toFixed(2)]
        );

        const order = orderResult.rows[0];

        for (const item of orderItems) {
            await client.query(
                `INSERT INTO order_items
           (order_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
                [order.id, item.productId, item.quantity, item.unitPrice]
            );

            await client.query(
                `UPDATE products
         SET stock = stock - $1
         WHERE id = $2`,
                [item.quantity, item.productId]
            );
        }

        await client.query("COMMIT");

        return res.status(201).json({
            success: true,
            message: "Order created; payment is pending",
            data: {
                ...order,
                items: orderItems,
            },
        });
    } catch (error) {
        if (client) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Rollback failed:", rollbackError.message);
            }
        }

        console.error("Failed to create order:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to create order",
        });
    } finally {
        if (client) {
            client.release();
        }
    }
});


/**
 * @openapi
 * /orders/{id}:
 *   get:
 *     summary: Get order details by ID
 *     tags:
 *       - Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Order ID
 *     responses:
 *       200:
 *         description: Order details retrieved successfully
 *       400:
 *         description: Invalid order ID
 *       401:
 *         description: Unauthorized or missing access token
 *       404:
 *         description: Order not found
 *       500:
 *         description: Internal server error
 */
router.get("/:id", async (req, res) => {
    const orderId = req.params.id;

    if (!/^[1-9]\d*$/.test(orderId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid order ID",
        });
    }

    try {
        const orderResult = await pool.query(
            `SELECT id, user_id, status, total_amount, created_at
       FROM orders
       WHERE id = $1 AND user_id = $2`,
            [orderId, req.user.id]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }

        const itemsResult = await pool.query(
            `SELECT
         product_id AS "productId",
         quantity,
         unit_price AS "unitPrice"
       FROM order_items
       WHERE order_id = $1
       ORDER BY id`,
            [orderId]
        );

        return res.status(200).json({
            success: true,
            data: {
                ...orderResult.rows[0],
                items: itemsResult.rows,
            },
        });
    } catch (error) {
        console.error("Failed to fetch order:", error.message);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch order",
        });
    }
});


module.exports = router;
