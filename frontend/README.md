# Frontend

Next.js application surface for TData.

- `src/app` contains pages, layouts, loading/error boundaries, and thin API adapter routes.
- `src/components` contains React UI. Components can fetch app endpoints and use browser-safe helpers.
- `public` contains static assets served by Next.js.

Do not put Prisma, filesystem access, raw external API clients, credentials, or long-running parser logic here. Put that in `backend/src` and call it through an API route or server component.
