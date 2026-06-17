# Deployment via Portainer

## Recommended: Portainer Stack from Git

This avoids manual `scp`, manual archive uploads, and repeated command-line deploys.

1. Push this project to a Git repository.
2. In Portainer open **Stacks**.
3. Click **Add stack**.
4. Choose **Repository**.
5. Set:
   - **Name**: `tdata`
   - **Repository URL**: `https://github.com/inftverezovsky/TData.git`
   - **Compose path**: `docker-compose.yml`
   - **Branch**: your deploy branch, for example `main`
6. In **Environment variables** add:
   - `POSTGRES_PASSWORD=<long unique database password>`
   - `ADMIN_PASSWORD=<long unique password>`
   - `ADMIN_SESSION_SECRET=<random 32+ byte secret>`
   - `ADMIN_COOKIE_SECURE=true` when served through HTTPS
   - `ADMIN_COOKIE_SECURE=false` only for temporary plain HTTP deployments
   - `ADMIN_UPLOAD_ALLOWED_HOSTS=<comma-separated admin API hosts>`
   - `ADMIN_AUTH_MODE=<basic|bearer|x-api-key>` or `ADMIN_MTLS_ENABLED=true`
   - `ADMIN_AUTH_ALLOW_NONE=1` only if the external Admin API intentionally has no auth
7. Deploy the stack.

For future updates:

1. Push code changes to Git.
2. Open the stack in Portainer.
3. Click **Pull and redeploy** or **Update the stack**.

If Portainer shows a webhook URL for the stack, save it. Future deploys can be triggered by opening that webhook URL or from GitHub Actions.

## Important Notes

- Do not use **Duplicate/Edit** for normal code deploys. It recreates a container from the existing image and may not rebuild the app.
- Use **Stack update**, **Pull and redeploy**, or **Rebuild image**.
- Keep the PostgreSQL volume. Do not delete the `tdata_postgres_data` volume unless you intentionally want to wipe the database.
- Never deploy with sample passwords or sample session secrets. Generate fresh values per environment.
- The PostgreSQL port is bound to `127.0.0.1` by default. Do not expose it publicly on the VPS.
- Keep `ADMIN_UPLOAD_ALLOWED_HOSTS` exact and narrow; production upload fails closed when it is empty.
- Put proxy URLs in `PROXY_AUTO_SEED_URLS` or the database only. Do not commit proxy credentials.
- Cron proxy checks must send `Authorization: Bearer <CRON_PROXY_CHECK_SECRET>`; query-string secrets are intentionally unsupported.
- If the site is served over plain HTTP, `ADMIN_COOKIE_SECURE=false` is required for login to work, but HTTPS with `ADMIN_COOKIE_SECURE=true` is the recommended production mode.

## What Must Exist in the Image

The app requires these runtime paths inside the `web` container:

- `/app/frontend/public` for homepage images.
- `/app/backend/prisma` for Prisma schema and migrations.
- `/app/scripts/hltv_playwright.mjs` for HLTV scraping.
- Playwright Chromium under `/ms-playwright`.

The Dockerfile copies and installs these. If HLTV says Playwright browser is missing, rebuild the image instead of only recreating the container.

## Fallback: Current PowerShell Deploy Script

From local PowerShell:

```powershell
cd C:\Users\Sa1z1ngr0z\Desktop\TData
.\scripts\deploy-all.ps1
```

This is a fallback, not the preferred long-term flow. It builds and pushes the Docker image and runs the configured SSH deploy helper. Add `-Prune` only when you intentionally want to clean unused local Docker images/build cache.
