const { createClient } = require("redis");

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

const redisClient = createClient({
    url: redisUrl,
});

redisClient.on("error", (err) => {
    console.error("[Redis] Client Error:", err.message);
});

redisClient.on("connect", () => {
    console.log("[Redis] Connected to Redis server");
});

(async () => {
    try {
        await redisClient.connect();
    } catch (err) {
        console.error("[Redis] Failed to connect to Redis:", err.message);
    }
})();

module.exports = redisClient;
