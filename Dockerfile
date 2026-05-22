# Build stage
FROM node:24 AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy the rest of the application
COPY . .

# Build the Next.js application
RUN npm run build

# Runtime stage
FROM node:24-slim AS runner

WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
ENV PORT 3010

# Copy necessary files from builder
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts ./scripts

# Install openssl for Prisma plus Chromium and system dependencies for Playwright.
RUN apt-get update -y && \
    apt-get install -y openssl ca-certificates && \
    npx playwright install --with-deps chromium && \
    rm -rf /var/lib/apt/lists/*

# Expose the app port used by Docker hosting and local compose.
EXPOSE 3010

# Command to run on start
CMD npm run db:migrate:deploy && npm run start
