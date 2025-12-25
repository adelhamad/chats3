# Chats3 Service - Copilot Instructions

This is the **Chats3** service, a chat microservice.

## Tech Stack
- **Language**: JavaScript (ES Modules)
- **Framework**: Fastify
- **Validation**: Zod
- **Process Manager**: PM2

## Core Principles & Best Practices

### Language & Tooling
- **Package Manager**: Always use **`yarn`** (never `npm`).
- **Process Management**: Use `yarn pm2` to interact with PM2 instances.
- **Verification**: Proactively run commands to verify your changes work as expected.

### Architecture & Modularity
- **Modular Design**: Keep work modular. Use the `modules/` directory for domain logic.
  - **Encapsulation**: Any functionality needed outside a module must be exported via its `index.js`.
- **Imports/Exports**: **Explicitly** name imports and exports.
  - ❌ `import * as utils from ...`
  - ❌ `export * from ...`
  - ✅ `import { specificFunction } from ...`

### Coding Philosophy
- **Simplicity**: Strive for the least amount of code necessary to be effective. Balance brevity with readability.
- **Configuration**: Do not over-engineer configuration or environment variables. It is acceptable to use constants for values that are unlikely to change across environments.
- **Locality of Behavior (LoB)**: Prioritize keeping related code and behavior close together to ensure the code is easy to understand and maintain.

## Service-Specific Guidelines

### Code Style & Structure
- Use **Async/Await** for all asynchronous operations.
- **Validation**: All request bodies, query params, and params must be validated using `zod` schemas.
- **Error Handling**: Use Fastify's built-in error handling. Throw standard errors that Fastify can catch.

### Development Workflow
- **Start Dev Server**: `yarn dev` (starts app with PM2 in watch mode).
- **Linting**: `yarn lint` (ESLint).

### Project Structure
- This is a **backend-only** service with no UI components.
- The `modules/example/` directory contains a minimal working example that can be used as a reference for creating new modules.
