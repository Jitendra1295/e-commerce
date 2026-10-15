
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const path = require("path");
const productRoutes = require("./routes/product.routes");
const orderRoutes = require("./routes/order.routes");
const authenticateToken = require("./middleware/auth.middleware");
const app = express();

app.use(
    helmet({
        contentSecurityPolicy: false,
    })
);
app.use(cors());
app.use(express.json());
app.use("/products", productRoutes);
app.use("/orders", authenticateToken, orderRoutes);

const swaggerSpec = swaggerJsdoc({
    definition: {
        openapi: "3.0.0",
        info: {
            title: "Order Service API",
            version: "1.0.0",
            description: "Product and order management microservice",
        },
        servers: [
            {
                url: `http://localhost:${process.env.PORT || 4002}`,
                description: "Local development server",
            },
        ],
        tags: [
            { name: "Products", description: "Product catalog and inventory" },
            { name: "Orders", description: "Order creation and processing" },
            { name: "Health", description: "Service health check" },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                    description: "Enter your JWT token obtained from Auth Service /auth/login",
                },
            },
        },
    },

    apis: [
        path.join(__dirname, "app.js").replace(/\\/g, "/"),
        path.join(__dirname, "routes", "*.js").replace(/\\/g, "/"),
    ],
});

app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
        customSiteTitle: "Order Service API Documentation",
    })
);

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Check Order Service health
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 service:
 *                   type: string
 *                   example: order-service
 *                 status:
 *                   type: string
 *                   example: healthy
 */
app.get("/health", (req, res) => {
    res.status(200).json({
        success: true,
        service: "order-service",
        status: "healthy",
    });
});

module.exports = app;
