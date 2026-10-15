const Stripe = require("stripe");

function getStripeClient() {
    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (
        !secretKey ||
        secretKey.startsWith("sk_test_placeholder") ||
        secretKey.includes("replace_with_your")
    ) {
        return null;
    }

    return new Stripe(secretKey);
}

module.exports = { getStripeClient };
