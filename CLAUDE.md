# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev       # Start with hot reload
npm run start:debug     # Start with debugger and hot reload

# Build
npm run build           # Compile TypeScript to dist/
npm run start:prod      # Run production build

# Code quality
npm run lint            # ESLint with auto-fix
npm run format          # Prettier format

# Testing
npm test                # Run unit tests
npm run test:watch      # Watch mode
npm run test:cov        # Coverage report
npm run test:e2e        # End-to-end tests

# Run a single test file
npx jest src/auth/auth.service.spec.ts
```

## Architecture

NestJS v11 backend with a feature-based modular structure. The app listens on `process.env.PORT` (default 3000).

**Tech stack:**
- **Database**: PostgreSQL via TypeORM (`@nestjs/typeorm`, `typeorm`, `pg`)
- **Auth**: JWT + Passport (`@nestjs/passport`, `passport-jwt`, `bcrypt`)
- **Real-time**: WebSockets via Socket.io (`@nestjs/websockets`, `@nestjs/platform-socket.io`)
- **Storage/BaaS**: Supabase (`@supabase/supabase-js`)

**Module layout** (`src/`):
- `auth/` — JWT authentication with role-based guards; contains `jwt.strategy.ts`, `guards/roles.guards.ts`, and DTOs for login/signup
- `users/` — User management
- `providers/` — Provider management
- `bookings/` — Booking management
- `chat/` — Real-time chat (Socket.io)
- `notifications/` — Notification service
- `storage/` — File/storage handling
- `admin/` — Admin operations
- `common/` — Shared utilities, decorators, interceptors

**Note**: Most feature modules are scaffolded (directories + empty files exist) but not yet implemented. `app.module.ts` is also currently empty and needs module imports wired up.

## TypeScript Config

- Target: ES2023, module resolution: `nodenext`
- Decorators enabled (`experimentalDecorators`, `emitDecoratorMetadata`) — required for TypeORM entities and NestJS DI
- Strict null checks on

## Code Style

- Single quotes, trailing commas (Prettier)
- `@typescript-eslint/no-explicit-any` is disabled — `any` is allowed
- Floating promises and unsafe arguments emit warnings, not errors
