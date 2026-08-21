FROM mcr.microsoft.com/playwright:v1.60.0-noble AS deps

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./
RUN npm ci

COPY backend/prisma ./backend/prisma
RUN npx prisma generate --schema backend/prisma/schema.prisma

FROM deps AS builder

WORKDIR /app

COPY . .
RUN npm run build

FROM deps AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PORT=3010

COPY --from=builder /app/frontend/next.config.mjs ./frontend/next.config.mjs
COPY --from=builder /app/frontend/.next ./frontend/.next
COPY --from=builder /app/frontend/public ./frontend/public
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/backend/src ./backend/src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/data/tessdata ./data/tessdata

EXPOSE 3010

CMD ["sh", "-c", "npm run db:migrate:deploy && npm run start"]
