const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Access token is required",
        });
    }

    const token = authorization.slice(7).trim();

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Access token is required",
        });
    }

    if (!process.env.JWT_SECRET) {
        console.error("JWT_SECRET is not configured");

        return res.status(500).json({
            success: false,
            message: "Authentication is not configured",
        });
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ["HS256"],
            issuer: "auth-service",
            audience: "ecommerce-api",
        });

        if (typeof payload.sub !== "string" || !payload.sub) {
            return res.status(401).json({
                success: false,
                message: "Invalid access token",
            });
        }

        req.user = {
            id: payload.sub,
        };

        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired access token",
        });
    }
}

module.exports = authenticateToken;
