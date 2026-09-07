# Deployment via Portainer

## Статус этой инструкции после аудита 07.09.2026

Документ описывает ручные варианты развёртывания, а не автоматический deploy
после `git push`. Текущий GitHub workflow проверяет проект и собирает Docker-архив;
сервер он не обновляет. Результаты локальных проверок и ограничения находятся в
[отчёте аудита](AUDIT_2026-09-07.md).

Локальные deploy helpers работают в режиме предварительного просмотра по умолчанию.
`scripts/ssh-redeploy.ps1` выполняет inventory контейнеров, Compose-проектов,
портов, диска и каталога; проверяет принадлежность web/worker/PostgreSQL проекту
`tdata` и пути `/root/tdata`. Публикуемый порт должен оставаться `127.0.0.1:3010`.
Изменения происходят только с `-Apply`; глобальный `-Prune` отклоняется.

Для выкладки нужен immutable digest `repository@sha256:...`. Скрипт проверяет
Prisma migration status до остановки приложения. Если есть pending/failed
миграции, выкладка останавливается: изменение схемы требует отдельного окна,
проверенной резервной копии и плана восстановления. В этом обновлении добавлена
миграция `20260907190000_admin_login_rate_limit`; она создаёт только новую таблицу
и индекс, не изменяя существующие данные. Её следует применить перед запуском
нового образа командой `npm run db:migrate:deploy` в окружении целевого приложения
после резервного копирования. Скрипт не откатывает схему автоматически.

При готовой схеме скрипт создаёт закрытую DB-копию в `/root/tdata/.deploy-backups/`
и проверяет её оглавление через `pg_restore --list`. Это проверка формата, а не
полная репетиция восстановления. Затем обновляет только `web` и `tline-worker`,
проверяет `ok=true` через локальный health endpoint и запущенный worker. При
ошибке возвращает прежний image ID обоих сервисов и повторяет health check;
даже успешный откат завершает deployment с ненулевым кодом.

Выбранный образ записывается без секретов в `/root/tdata/.deploy-image.env`.
Для последующего ручного Compose-запуска используйте оба env-файла:
`docker compose --env-file .env --env-file .deploy-image.env -p tdata ...`.
Резервные копии, lock и receipt исключены из Git и Docker context. Nginx,
порты 80/443 и посторонние контейнеры скрипт не изменяет.

SSH использует ключ `C:\Users\Sa1z1ngr0z\.ssh\codex_deploy_ed25519` и строгую
проверку known_hosts. При первом подключении проверьте fingerprint сервера
через доверенный канал и зарегистрируйте хост обычным интерактивным SSH.
Рабочие секреты остаются в существующем runtime environment/Portainer.
После обновления потребуется повторный вход администратора.

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

## PowerShell pipeline

Предварительный просмотр не запускает Docker и SSH:

```powershell
cd C:\Users\Sa1z1ngr0z\Desktop\TData
.\scripts\deploy-all.ps1 -Tag audit-20260907
```

После отдельного разрешения на публикацию/выкладку и подготовки схемы:

```powershell
.\scripts\deploy-all.ps1 -Tag audit-20260907 -Apply
```

Pipeline выполняет `npm run check`, собирает и публикует image, получает его
registry digest и передаёт именно этот digest SSH helper. Один только
`build-and-push.ps1 -Apply` публикует образ и не объявляет сервер обновлённым.
Если имя/каталог/контейнеры не соответствуют canonical TData, helper останавливается.
Сначала нужно проверить фактическое размещение, а не создавать второй проект.

Локальные проверки helper выполняются без daemon/SSH:

```bash
npx tsx --test tests/deploymentScripts.test.ts
bash -n scripts/deploy/remote-redeploy.sh
for scenario in success foreign port configport configimage migration backup upfail healthfail wrongimage rollbackfail; do
  bash tests/fixtures/deployment/remote-harness.sh "$scenario" "$PWD/scripts/deploy/remote-redeploy.sh"
done
```
