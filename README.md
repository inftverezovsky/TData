<div align="center">

# 🏟️ TData

### Единый операторский центр турнирных данных

Поиск и импорт турниров, нормализация расписаний, сопоставление команд,
подготовка Admin/FIxt payload и отдельный контур результатов КХЛ.

[![Next.js](https://img.shields.io/badge/Next.js-16.3.1-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149ECA?style=for-the-badge&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

[Production](https://www.tdata.info/) ·
[Health](https://www.tdata.info/api/health) ·
[KHL Results](https://www.tdata.info/results/khl)

</div>

---

## Что такое TData

TData объединяет несколько операторских сценариев в одном Next.js-приложении:

- получает турнирные данные из внешних спортивных источников;
- приводит разные форматы матчей и участников к общей модели;
- сохраняет исходные снимки, диагностические данные и нормализованные сущности;
- помогает сопоставлять команды и игроков с Admin ID;
- формирует и проверяет payload перед отправкой во внешнюю систему;
- ведёт отдельный fail-closed процесс сбора и подготовки результатов КХЛ.

Проект рассчитан на ручную работу оператора, автоматические фоновые задачи и
воспроизводимое развёртывание через Docker Compose.

## Возможности

| Контур | Что поддерживается |
|---|---|
| **Cyber** | Dota 2, Counter-Strike, League of Legends и Valorant: поиск, импорт, расписания, маппинг и экспорт |
| **KHL Results** | Сбор завершённых матчей, официальный протокол, команды и игроки, статистика, bindings, preview, diff и staging |
| **TBvolley** | VolleyballWorld, beach.volley.ru, German Beach Tour, CSVP, Austrian Beach Tour, CBV Brasil и Italy Federvolley |
| **TableT** | Поиск и импорт турниров WTT, категории и пакетная обработка |
| **Ручной импорт** | Текст, изображения, локальный OCR, пакетная обработка и опциональный AI parser |
| **Admin integration** | Team mapping, FIxt payload, история отправок, allowlist, Basic/Bearer/API key и mTLS |
| **Диагностика** | Health API, parser logs, proxy pool, source cache и пользовательские классы ошибок |

## KHL Results

Раздел **«Результаты → КХЛ»** — самостоятельный вертикальный модуль:

- автоматический и ручной ingest расписания и протоколов;
- хранение raw snapshot и ревизий матча;
- нормализация командной и индивидуальной статистики;
- привязки команд, игроков, матча и статистических ID;
- вкладки «Матчи сегодня», «Статистика игрового дня» и «Архив»;
- preview канонического Admin payload и SHA-256 hash;
- diff относительно последней подготовленной версии;
- идемпотентный staging без скрытой отправки;
- автоматическая синхронизация через systemd timer;
- fail-closed поведение при неполных, неоднозначных или отклонённых данных.

Подробная история и правила модуля находятся в [KHL_HANDOFF.md](KHL_HANDOFF.md),
а настройка фонового таймера — в [deploy/systemd/README.md](deploy/systemd/README.md).

## Архитектура

```mermaid
flowchart LR
    Operator[Оператор] --> UI[Next.js UI]
    UI --> API[Route handlers]
    API --> Domain[Backend services]

    Sources[Liquipedia · HLTV · VLR · DLTV · Fandom · TBvolley · WTT]
    Sources --> Fetch[Fetchers, rate limits, proxy policy]
    Fetch --> Normalize[Normalizers and deduplication]
    Normalize --> Domain

    KHL[KHL schedule and protocol API] --> KhlPipeline[KHL ingest and revision pipeline]
    KhlPipeline --> Domain

    Domain --> DB[(PostgreSQL / Prisma)]
    Domain --> Cache[(Source and parser cache)]
    Domain --> Preview[Admin payload preview and diff]
    Preview --> Delivery[Controlled staging / delivery]
```

### Основные слои

- `frontend/src/app` — страницы App Router и HTTP route handlers;
- `frontend/src/components` — операторский интерфейс;
- `backend/src` — доменная логика, источники, нормализаторы и политики;
- `backend/prisma` — схема PostgreSQL и миграции;
- `scripts` — CLI, проверки, импорт и автоматизация;
- `tests` — unit, integration и Playwright E2E проверки.

## Технологии

| Область | Стек |
|---|---|
| Web | Next.js 16.3.1, React 19, TypeScript |
| Data | PostgreSQL 16, Prisma 5 |
| Parsing | Cheerio, Playwright, source-specific clients |
| OCR | Tesseract.js, Sharp |
| UI | Tailwind CSS, Framer Motion, Lucide |
| Проверки | Node test runner через TSX, Playwright E2E, ESLint, TypeScript |
| Runtime | Node.js 24, Docker, Docker Compose, nginx |

## Быстрый запуск

### Требования

- Node.js 24;
- npm;
- PostgreSQL 16 или Docker;
- Git.

### 1. Получить проект

```bash
git clone https://github.com/inftverezovsky/TData.git
cd TData
npm ci
```

### 2. Создать локальное окружение

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Linux/macOS:

```bash
cp .env.example .env
```

Файл `.env` уже исключён из Git. Не добавляйте в репозиторий реальные пароли,
токены, ключи, сертификаты и URL с учётными данными.

Минимально проверьте следующие настройки:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5434/tdata?schema=public"
LIQUIPEDIA_USER_AGENT="tdata-local/1.0 (contact: you@example.com)"
ADMIN_PASSWORD="replace-with-a-local-password"
ADMIN_SESSION_SECRET="replace-with-a-long-random-value"
ADMIN_UPLOAD_ALLOWED_HOSTS="admin.example.com"
```

Это только безопасные placeholders. Реальные значения должны оставаться в
локальном `.env` или в secret storage среды развёртывания.

### 3. Подготовить Prisma и запустить приложение

```bash
npm run prisma:generate
npm run db:migrate:deploy
npm run dev
```

Приложение будет доступно на `http://localhost:3010`.

## Docker Compose

Перед запуском заполните `.env`, затем проверьте итоговую конфигурацию:

```bash
docker compose config -q
docker compose up -d --build
docker compose ps
```

Локальная проверка контейнера:

```bash
curl http://127.0.0.1:3010/api/health
```

Compose публикует web и PostgreSQL только на loopback-интерфейсе. Публичный
HTTPS в production обслуживается отдельным nginx.

## Команды разработчика

| Команда | Назначение |
|---|---|
| `npm run dev` | Локальный Next.js dev server на порту 3010 |
| `npm run build` | Production-сборка и генерация Prisma Client |
| `npm run start` | Запуск готовой production-сборки |
| `npm run typecheck` | Проверка TypeScript без генерации файлов |
| `npm run lint` | ESLint для всего репозитория |
| `npm test` | Основной набор TS-тестов |
| `npm run test:e2e` | Playwright E2E |
| `npm run prisma:generate` | Обновление Prisma Client |
| `npm run db:migrate:deploy` | Применение существующих миграций |
| `npm run sync:khl-results` | Однократный запуск KHL sync runner |

DB-интеграционные KHL-тесты требуют отдельную loopback-базу с именем,
содержащим `test`, и переменную `TEST_DATABASE_URL`. Никогда не направляйте их
на production-базу.

## TData CLI

```bash
npx tsx scripts/tdata-cli.ts help
```

Доступные операции:

- `db:check` — соединение с PostgreSQL и основные счётчики;
- `cache:clear` — очистка search cache и parser logs;
- `proxy:check` — состояние proxy pool;
- `deploy` — локальный checklist готовности.

## Структура репозитория

```text
TData/
├── frontend/
│   ├── public/
│   └── src/
│       ├── app/
│       │   ├── api/
│       │   └── results/khl/
│       └── components/
│           └── results/khl/
├── backend/
│   ├── prisma/
│   │   └── migrations/
│   └── src/
│       ├── results/khl/
│       ├── sources/
│       ├── normalizers/
│       ├── teams/
│       ├── manualImport/
│       └── adminUpload/
├── deploy/systemd/
├── scripts/
├── tests/
│   ├── e2e/
│   └── fixtures/khl/
├── .env.example
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## Безопасность

- все mutation routes KHL защищены admin session и same-origin проверками;
- исходящие URL проходят host allowlist и SSRF-политику;
- Admin delivery поддерживает Basic, Bearer, API key и mTLS;
- секреты читаются только из окружения и не должны попадать в Git;
- raw snapshots и rejected revisions сохраняются для диагностики;
- неполный binding или неоднозначный матч блокирует payload целиком;
- автоматические проверки используют только явно изолированную тестовую БД.

## Проверка качества

Базовый локальный gate:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Расширенный E2E gate запускается отдельно, когда доступны браузеры и безопасная
тестовая база:

```bash
npm run test:e2e
npm run test:e2e:db
```

## Как убедиться, что GitHub показывает актуальную версию

GitHub показывает рядом с каждым файлом или каталогом **последний коммит,
который менял именно этот путь**. Поэтому `last week` у папки не означает, что
ветка устарела.

Проверять нужно SHA вершины `main`:

```bash
git fetch origin main
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
```

Оба SHA должны совпадать, а статус должен показывать `main...origin/main` без
локальных изменений.

## Сохранение в GitHub

Проектный save-agent проверяет корень репозитория, настраивает правильный
`origin`, создаёт коммит и отправляет его в `main`:

```powershell
npm run git:save -- -Message "docs: update project documentation"
```

Используется репозиторий:
[`inftverezovsky/TData`](https://github.com/inftverezovsky/TData).

---

<div align="center">

**TData** · Tournament data should be traceable, reviewable and safe to deliver.

</div>
