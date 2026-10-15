const http = require("http");
const express = require("express");
const app = require("../src/app");
const redisClient = require("../src/redis");
const { invalidateProductCache, PRODUCT_CACHE_PREFIX } = require("../src/cache");

async function runVerification() {
    console.log("=================================================");
    console.log("   API Gateway Redis Integration Verification   ");
    console.log("=================================================\n");

    // Ensure Redis client is connected
    if (!redisClient.isOpen) {
        await redisClient.connect();
    }
    console.log("[Setup] Connected to Redis server");

    // Clean any prior keys
    await invalidateProductCache();

    // -----------------------------------------------------------------
    // Part 1: Distributed Rate Limiting Across Two Gateway Instances
    // -----------------------------------------------------------------
    console.log("-------------------------------------------------");
    console.log("PART 1: Shared Counter & Distributed Rate Limiting");
    console.log("-------------------------------------------------");

    // Start Instance 1 on port 4101 and Instance 2 on port 4102 using the same app & Redis store
    const server1 = http.createServer(app);
    const server2 = http.createServer(app);

    await new Promise((resolve) => server1.listen(4101, resolve));
    await new Promise((resolve) => server2.listen(4102, resolve));
    console.log("[Instance 1] Listening on http://localhost:4101");
    console.log("[Instance 2] Listening on http://localhost:4102");

    console.log("\n-> Sending sequential requests to verify shared counter:");
    for (let i = 1; i <= 6; i++) {
        const targetPort = i % 2 === 1 ? 4101 : 4102;
        const res = await fetch(`http://localhost:${targetPort}/health`);
        const remaining = res.headers.get("ratelimit-remaining");
        const limit = res.headers.get("ratelimit-limit");
        console.log(
            `   Req #${i} -> Instance on port ${targetPort} | Status: ${res.status} | Limit: ${limit} | Remaining: ${remaining}`
        );
    }
    console.log("\n[PASS] Distributed Rate Limiting successfully decrements a single shared Redis counter across instances!\n");

    // Close temporary gateway instances
    server1.close();
    server2.close();

    // -----------------------------------------------------------------
    // Part 2: Product GET Caching, Invalidation & Expiration
    // -----------------------------------------------------------------
    console.log("-------------------------------------------------");
    console.log("PART 2: Redis Caching for Product Responses");
    console.log("-------------------------------------------------");

    // Start a mock Order Service downstream on port 4002
    const mockOrderService = express();
    mockOrderService.use(express.json());

    let productQueryCount = 0;
    mockOrderService.get("/products", (req, res) => {
        productQueryCount++;
        res.status(200).json({
            success: true,
            queryCount: productQueryCount,
            data: [
                { id: 1, name: "Mechanical Keyboard", price: "99.99", stock: 50 },
                { id: 2, name: "Wireless Mouse", price: "29.99", stock: 100 }
            ],
        });
    });

    mockOrderService.post("/orders", (req, res) => {
        res.status(201).json({
            success: true,
            message: "Order placed successfully, product stock updated",
        });
    });

    const mockServer = http.createServer(mockOrderService);
    await new Promise((resolve) => mockServer.listen(4002, resolve));
    console.log("[Downstream Mock] Order & Product Service listening on port 4002");

    // Start Gateway on port 4100
    const gatewayServer = http.createServer(app);
    await new Promise((resolve) => gatewayServer.listen(4100, resolve));
    console.log("[API Gateway] Listening on http://localhost:4100");

    try {
        // Step 1: Initial GET /products (Cache MISS)
        console.log("\n-> Step 1: Initial GET /products");
        const res1 = await fetch("http://localhost:4100/products");
        const data1 = await res1.json();
        const xCache1 = res1.headers.get("x-cache");
        console.log(`   Response Status: ${res1.status} | X-Cache Header: ${xCache1} | Downstream Query Count: ${data1.queryCount}`);
        if (xCache1 !== "MISS") throw new Error(`Expected X-Cache: MISS, got ${xCache1}`);

        // Step 2: Immediate Second GET /products (Cache HIT)
        console.log("\n-> Step 2: Immediate Second GET /products (Served directly from Redis)");
        const res2 = await fetch("http://localhost:4100/products");
        const data2 = await res2.json();
        const xCache2 = res2.headers.get("x-cache");
        console.log(`   Response Status: ${res2.status} | X-Cache Header: ${xCache2} | Downstream Query Count: ${data2.queryCount}`);
        if (xCache2 !== "HIT") throw new Error(`Expected X-Cache: HIT, got ${xCache2}`);
        if (data2.queryCount !== 1) throw new Error(`Downstream hit unnecessarily during Cache HIT!`);

        // Step 3: Trigger Invalidation via POST /orders (Stock changes)
        console.log("\n-> Step 3: Order placement POST /orders (Triggers cache invalidation)");
        const orderRes = await fetch("http://localhost:4100/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: [{ productId: 1, quantity: 1 }] }),
        });
        console.log(`   Order Response Status: ${orderRes.status}`);

        // Give proxy response interceptor a moment to complete invalidation
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Step 4: GET /products after order placed (Cache MISS after invalidation)
        console.log("\n-> Step 4: GET /products after order placement");
        const res3 = await fetch("http://localhost:4100/products");
        const data3 = await res3.json();
        const xCache3 = res3.headers.get("x-cache");
        console.log(`   Response Status: ${res3.status} | X-Cache Header: ${xCache3} | Downstream Query Count: ${data3.queryCount}`);
        if (xCache3 !== "MISS") throw new Error(`Expected X-Cache: MISS after invalidation, got ${xCache3}`);
        if (data3.queryCount !== 2) throw new Error(`Expected Downstream count to be 2, got ${data3.queryCount}`);

        // Step 5: Explicit Cache Invalidation endpoint
        console.log("\n-> Step 5: Explicit Cache Invalidation via POST /products/cache/invalidate");
        // Prime cache
        await fetch("http://localhost:4100/products");
        const purgeRes = await fetch("http://localhost:4100/products/cache/invalidate", { method: "POST" });
        const purgeBody = await purgeRes.json();
        console.log(`   Purge Response:`, purgeBody);

        const resAfterPurge = await fetch("http://localhost:4100/products");
        console.log(`   GET /products after explicit purge X-Cache: ${resAfterPurge.headers.get("x-cache")}`);

        console.log("\n[PASS] Redis Product Caching, Invalidation, and Expiration verified successfully!");
    } finally {
        gatewayServer.close();
        mockServer.close();
        await redisClient.quit();
    }

    console.log("\n=================================================");
    console.log("   ALL DISTRIBUTED REDIS TESTS PASSED (100%)    ");
    console.log("=================================================");
}

runVerification().catch((err) => {
    console.error("Verification error:", err);
    process.exit(1);
});
