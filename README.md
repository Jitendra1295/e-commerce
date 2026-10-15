# Microservices E-Commerce

A distributed e-commerce backend built with Node.js/Express, Redis, PostgreSQL, and RabbitMQ.

## Architecture

- **API Gateway (`port 4000`)**: Request routing, security headers (Helmet), CORS, distributed rate limiting via Redis, and product response caching with automatic invalidation.
- **Auth Service (`port 4001`)**: User registration, authentication, and JWT token management.
- **Order Service (`port 4002`)**: Product catalog management and order processing with inventory checks.
- **Payment Service (`port 4003`)**: Payment processing and asynchronous event publishing via RabbitMQ.

## Features

- **Distributed Rate Limiting**: Shared Redis counters across API Gateway instances.
- **Response Caching**: In-memory Redis caching for product endpoints (`GET /products`) with automatic cache invalidation on order placement or product updates.
- **Microservices Routing**: Reverse proxy with request tracing (`X-Request-Id`) and timeout handling.
