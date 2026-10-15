
const express = require("express");
const pool = require("../config/db");

const router = express.Router();

/**
 * @openapi
 * /products:
 *   get:
 *     summary: Get all products
 *     tags:
 *       - Products
 *     responses:
 *       200:
 *         description: List of products
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 2
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       name:
 *                         type: string
 *                         example: Wireless Mouse
 *                       description:
 *                         type: string
 *                         example: Ergonomic wireless mouse
 *                       price:
 *                         type: string
 *                         example: "29.99"
 *                       stock:
 *                         type: integer
 *                         example: 100
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                         example: "2026-10-14T07:00:00.000Z"
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
 *                   example: Failed to fetch products
 */
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, description, price, stock, created_at
       FROM products
       ORDER BY id ASC`
        );

        res.status(200).json({
            success: true,
            count: result.rows.length,
            data: result.rows,
        });
    } catch (error) {
        console.error("Failed to fetch products:", error.message);

        res.status(500).json({
            success: false,
            message: "Failed to fetch products",
        });
    }
});

module.exports = router;
