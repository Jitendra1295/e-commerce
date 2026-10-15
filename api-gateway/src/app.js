require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { randomUUID } = require("crypto");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { RedisStore } = require("rate-limit-redis");
const redisClient = require("./redis");
const {
    invalidateProductCache,
    productCacheMiddleware,
    productCacheInterceptor,
    orderInvalidationInterceptor,
} = require("./cache");

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || "http://localhost:4001";
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || "http://localhost:4002";
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || "http://localhost:4003";

const app = express();

// 1. Security Headers (Helmet)
app.use(
    helmet({
        contentSecurityPolicy: false,
    })
);

// 2. CORS Configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
    : ["http://localhost:3000", "http://localhost:5173"];

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
                return callback(null, true);
            }
            return callback(new Error("Not allowed by CORS"));
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "X-Request-Id",
            "Idempotency-Key",
            "stripe-signature",
        ],
        exposedHeaders: [
            "X-Request-Id",
            "RateLimit-Limit",
            "RateLimit-Remaining",
            "RateLimit-Reset",
        ],
    })
);

// 3. Request Tracing Middleware
app.use((req, res, next) => {
    const requestId = req.headers["x-request-id"] || randomUUID();
    req.headers["x-request-id"] = requestId;
    res.setHeader("X-Request-Id", requestId);
    next();
});

// 4. Rate Limiting
const createRedisStore = (prefix) =>
    new RedisStore({
        prefix,
        sendCommand: (...args) => redisClient.sendCommand(args),
    });

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore("gateway:general:"),
    skip: (req) => req.originalUrl.includes("/payments/webhook"),
    message: {
        success: false,
        message: "Too many requests from this IP, please try again after 15 minutes",
    },
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore("gateway:auth:"),
    message: {
        success: false,
        message: "Too many authentication attempts, please try again after 15 minutes",
    },
});

app.use(generalLimiter);
app.use("/auth", authLimiter);

// 5. Health Check
app.get("/health", (req, res) => {
    res.status(200).json({
        service: "api-gateway",
        status: "healthy",
        timestamp: new Date().toISOString(),
    });
});

// 6. Proxy Error Handler (Bad Gateway & Gateway Timeout)
const handleProxyError = (err, req, res) => {
    console.error(`[API Gateway] Proxy error on ${req.method} ${req.originalUrl}:`, err.message);

    if (res.headersSent) {
        return;
    }

    if (
        err.code === "ECONNRESET" ||
        err.code === "ETIMEDOUT" ||
        err.code === "ESOCKETTIMEDOUT"
    ) {
        return res.status(504).json({
            success: false,
            message: "Gateway Timeout: The downstream service took too long to respond",
        });
    }

    return res.status(502).json({
        success: false,
        message: "The requested service is temporarily unavailable",
    });
};

// 7. Proxy Helper with Timeouts
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS) || 15000;

const createServiceProxy = (targetUrl, routePrefix, extraOptions = {}) => {
    const { on: customOn = {}, ...rest } = extraOptions;

    return createProxyMiddleware({
        target: targetUrl,
        changeOrigin: true,
        pathRewrite: (path) => `${routePrefix}${path}`,
        timeout: PROXY_TIMEOUT_MS,
        proxyTimeout: PROXY_TIMEOUT_MS,
        ...rest,
        on: {
            proxyReq: (proxyReq, req) => {
                if (req.headers["x-request-id"]) {
                    proxyReq.setHeader("x-request-id", req.headers["x-request-id"]);
                }
                if (customOn.proxyReq) {
                    customOn.proxyReq(proxyReq, req);
                }
            },
            error: handleProxyError,
            ...customOn,
        },
    });
};

// 8. Service Routes
// Auth Service: port 4001
app.use("/auth", createServiceProxy(AUTH_SERVICE_URL, "/auth"));

// Explicit Product Cache Invalidation Endpoints
app.post("/products/cache/invalidate", async (req, res) => {
    const count = await invalidateProductCache();
    res.status(200).json({
        success: true,
        message: "Product cache invalidated successfully",
        keysRemoved: count,
    });
});
app.delete("/products/cache", async (req, res) => {
    const count = await invalidateProductCache();
    res.status(200).json({
        success: true,
        message: "Product cache invalidated successfully",
        keysRemoved: count,
    });
});

// Order Service: port 4002 (with cache invalidation on order creation)
app.use(
    "/orders",
    createServiceProxy(ORDER_SERVICE_URL, "/orders", {
        selfHandleResponse: true,
        on: {
            proxyRes: orderInvalidationInterceptor,
        },
    })
);

// Product Catalog: port 4002 (with Redis cache middleware & response caching/invalidation)
app.use(
    "/products",
    productCacheMiddleware,
    createServiceProxy(ORDER_SERVICE_URL, "/products", {
        selfHandleResponse: true,
        on: {
            proxyRes: productCacheInterceptor,
        },
    })
);

// Payment Service: port 4003
app.use("/payments", createServiceProxy(PAYMENT_SERVICE_URL, "/payments"));

// 9. Unknown Gateway Routes (404)
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "API route not found",
    });
});

module.exports = app;
