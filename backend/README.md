# Backend

Server-side domain layer for TData.

- `src` contains business logic, parsers, source integrations, upload services, auth, sync, cache, and database access.
- `prisma` contains the schema, migrations, and seed script.

Next.js API routes in `frontend/src/app/api` should stay thin and call this layer through the `@backend/*` alias. Keep UI components out of this folder.
