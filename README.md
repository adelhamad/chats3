# Chats3 Service

A clean, minimal backend service for chat functionality.

## Tech Stack

- **Language**: JavaScript (ES Modules)
- **Framework**: Fastify
- **Validation**: Zod
- **Process Manager**: PM2

## Getting Started

### Prerequisites

- Node.js (v16+)
- Yarn package manager

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   yarn install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

### Development

Start the development server with hot reload:
```bash
yarn run dev
```

The server will start on `http://localhost:3000` (or the port specified in your `.env`).

### Available Scripts

- `yarn run dev` - Start development server with PM2 watch mode
- `yarn run start` - Start production server with PM2
- `yarn run stop` - Stop PM2 process
- `yarn run clean` - Delete all PM2 processes
- `yarn run lint` - Run ESLint

## API Endpoints

### Health Check
```
GET /health
```
Returns service status.

### Example Endpoints
```
GET /api/v1/example
GET /api/v1/example/:id
```
Example endpoints for reference (can be removed when implementing actual chat logic).

## Project Structure

```
src/
├── app.js              # Main application entry point
├── config/             # Configuration files
├── constants/          # Application constants
└── modules/            # Feature modules
    └── example/        # Example module (reference implementation)
```

## Development Guidelines

- Use **async/await** for all asynchronous operations
- Validate all request inputs using **Zod** schemas
- Keep modules self-contained with clear exports
- Follow the existing code style (check ESLint rules)

## License

ISC