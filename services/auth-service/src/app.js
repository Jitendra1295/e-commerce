
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const path = require("path");
const authRoutes = require("./routes/auth.routes");
const app = express();

app.use(
    helmet({
        contentSecurityPolicy: false,
    })
);
app.use(cors());
app.use(express.json());
app.use("/auth", authRoutes);

const swaggerSpec = swaggerJsdoc({
    definition: {
        openapi: "3.0.0",
        info: {
            title: "Auth Service API",
            version: "1.0.0",
            description: "Authentication and user management",
        },
        servers: [
            {
                url: `http://localhost:${process.env.PORT || 4001}`,
                description: "Local development server",
            },
        ],
        tags: [
            { name: "Auth", description: "Authentication endpoints" },
            { name: "Health", description: "Service health check" },
        ],
    },
    apis: [path.join(__dirname, "**/*.js").replace(/\\/g, "/")],
});

app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
        customSiteTitle: "Auth Service API Documentation",
    })
);

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Check Auth Service health
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
 *                   example: auth-service
 *                 status:
 *                   type: string
 *                   example: healthy
 */
app.get("/health", (req, res) => {
    res.status(200).json({
        success: true,
        service: "auth-service",
        status: "healthy",
    });
});

module.exports = app;
