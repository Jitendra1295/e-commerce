const { responseInterceptor } = require("http-proxy-middleware");
const redisClient = require("./redis");

const PRODUCT_CACHE_TTL_SECONDS = Number(process.env.PRODUCT_CACHE_TTL_SECONDS) || 60;
const PRODUCT_CACHE_PREFIX = "cache:products:";

/**
 * Invalidate all cached product entries in Redis.
 */
const invalidateProductCache = async () => {
    try {
        const keys = await redisClient.keys(`${PRODUCT_CACHE_PREFIX}*`);
        if (keys && keys.length > 0) {
            await redisClient.del(keys);
            console.log(`[Redis Cache] Invalidated ${keys.length} product cache key(s)`);
            return keys.length;
        }
        return 0;
    } catch (err) {
        console.error("[Redis Cache] Invalidation error:", err.message);
        return 0;
    }
};

/**
 * Express middleware to serve cached GET responses for products.
 */
const productCacheMiddleware = async (req, res, next) => {
    if (req.method !== "GET") {
        return next();
    }

    try {
        const cacheKey = `${PRODUCT_CACHE_PREFIX}${req.originalUrl}`;
        const cached = await redisClient.get(cacheKey);

        if (cached) {
            res.setHeader("X-Cache", "HIT");
            res.setHeader("Content-Type", "application/json");
            return res.status(200).send(cached);
        }
    } catch (err) {
        console.error("[Redis Cache] Read error:", err.message);
    }

    next();
};

/**
 * Proxy response interceptor for /products.
 * - Caches successful GET responses in Redis with expiration TTL.
 * - Invalidates cache on successful product mutations (POST, PUT, PATCH, DELETE).
 */
const productCacheInterceptor = responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
    if (req.method === "GET" && proxyRes.statusCode === 200) {
        try {
            const cacheKey = `${PRODUCT_CACHE_PREFIX}${req.originalUrl}`;
            await redisClient.set(cacheKey, responseBuffer.toString("utf8"), {
                EX: PRODUCT_CACHE_TTL_SECONDS,
            });
            res.setHeader("X-Cache", "MISS");
        } catch (err) {
            console.error("[Redis Cache] Save error:", err.message);
        }
    }

    // Invalidate product cache on mutations
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && proxyRes.statusCode < 400) {
        invalidateProductCache().catch((err) =>
            console.error("[Redis Cache] Invalidation error on product mutation:", err.message)
        );
    }

    return responseBuffer;
});

/**
 * Proxy response interceptor for /orders.
 * - When an order is placed (POST /orders), product stock is decremented.
 *   Invalidate product cache so subsequent GET /products returns updated inventory.
 */
const orderInvalidationInterceptor = responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
    if (req.method === "POST" && (proxyRes.statusCode === 201 || proxyRes.statusCode === 200)) {
        invalidateProductCache().catch((err) =>
            console.error("[Redis Cache] Invalidation error on order creation:", err.message)
        );
    }

    return responseBuffer;
});

module.exports = {
    PRODUCT_CACHE_TTL_SECONDS,
    PRODUCT_CACHE_PREFIX,
    invalidateProductCache,
    productCacheMiddleware,
    productCacheInterceptor,
    orderInvalidationInterceptor,
};
