
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const path = require("path");
const paymentRoutes = require("./routes/payment.routes");
const authenticateToken = require("./middleware/auth.middleware");

const app = express();

app.use(
    helmet({
        contentSecurityPolicy: false,
    })
);
app.use(cors());
app.use(
    express.json({
        verify: (req, res, buf) => {
            req.rawBody = buf;
        },
    })
);
app.use("/payments", paymentRoutes);

const swaggerSpec = swaggerJsdoc({
    definition: {
        openapi: "3.0.0",
        info: {
            title: "Payment Service API",
            version: "1.0.0",
            description: "Payment processing and status",
        },
        servers: [
            {
                url: `http://localhost:${process.env.PORT || 4003}`,
                description: "Local development server",
            },
        ],
        tags: [
            { name: "Payments", description: "Payment processing endpoints" },
            { name: "Health", description: "Service health check" },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                },
            },
        },
    },
    apis: [path.join(__dirname, "**/*.js").replace(/\\/g, "/")],
});

app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
        customSiteTitle: "Payment Service API Documentation",
    })
);

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Check Payment Service health
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is healthy
 */
app.get("/health", (req, res) => {
    res.status(200).json({
        success: true,
        service: "payment-service",
        status: "healthy",
    });
});

module.exports = app;
