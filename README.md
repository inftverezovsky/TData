<div align="center">

# TData

**Рабочее место для импорта и проверки спортивных данных**

Поиск турниров · Расписания · Сопоставление команд · Подготовка и отправка в Admin

[Сайт проекта](https://www.tdata.info/) · [Архитектура](docs/ARCHITECTURE.md) · [Путеводитель по коду](docs/CODE_GUIDE.md) · [Проверки](docs/TESTING.md)

</div>

---

TData собирает турнирные данные из разных источников и помогает оператору подготовить их к загрузке во внешнюю систему. В одном интерфейсе можно найти турнир, проверить расписание, сопоставить участников с внутренними ID и просмотреть результат перед отправкой.

**Основной процесс:** источник → импорт → проверка матчей → сопоставление ID → предпросмотр → подтверждённая отправка.

## Возможности

| Раздел                    | Задача оператора                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cyber**                 | Поиск и импорт турниров Dota 2, Counter-Strike, League of Legends и Valorant. Источники: Liquipedia, HLTV, DLTV, Fandom и VLR.                                                        |
| **TBvolley**              | Работа с VolleyballWorld, beach.volley.ru, German Beach Tour, CSVP, Austrian Beach Tour, CBV Brasil и Federvolley. Общие формы поиска и импорт сеток.                                 |
| **TableT**                | Поиск и импорт турниров WTT, выбор категорий и пакетная обработка.                                                                                                                    |
| **Ручной импорт**         | Распознавание текста и скриншотов, очередь без дубликатов, AI и резервный OCR, редактирование матчей и сохранение ID команд.                                                          |
| **TLine**                 | Сверка расписания волейбола, флорбола и белорусского хоккея с линией Admin. Правила чемпионатов, сопоставления, история проверок и ручные решения. Доступ к Admin — только на чтение. |
| **Результаты КХЛ**        | Сбор протоколов, статистика команд и игроков, привязки ID, версии данных, предпросмотр и подготовка результата к передаче.                                                            |
| **Admin и настройки**     | Справочники команд, параметры импорта, FIxt payload, явная отправка и история загрузок.                                                                                               |
| **Мониторинг и Telegram** | Проверка доступности и качества парсеров; приватный консультант по документации проекта с лимитом обращений к DeepSeek. Консультант не меняет данные или состояние сервера.           |

Рабочие разделы TLine, КХЛ и Sandbox открываются без пароля. Вход администратора нужен для раздела настроек API и фактической внешней отправки. Импорт и предпросмотр выполняются отдельно от отправки. В контуре КХЛ **staging означает подготовку результата**, а не его автоматическую передачу во внешнюю систему. Автоматические проверки TLine включаются после настройки источников и доступа к Admin: [инструкция TLine](docs/TLINE.md).

## Устройство проекта

Один корневой npm-проект: `frontend/` содержит Next.js-интерфейс и HTTP-маршруты, `backend/` — бизнес-логику, интеграции и хранение. Отдельные npm-проекты или второй HTTP-сервер для backend не нужны.

```mermaid
flowchart LR
    Operator[Оператор] --> UI[Next.js: интерфейс]
    UI --> API[API: доступ и валидация]
    API --> Services[Backend: сценарии и правила]
    Sources[Спортивные источники] --> Normalize[Парсинг и нормализация]
    Services <--> Normalize
    Services <--> DB[(PostgreSQL / Prisma)]
    Services --> Preview[Сопоставления и предпросмотр]
    Preview --> Export[Явная отправка / staging]
```

```text
TData/
├── frontend/
│   ├── public/                  # Статические файлы
│   └── src/
│       ├── app/                 # Страницы и API routes
│       ├── components/          # Экраны и компоненты по предметным областям
│       ├── hooks/               # Общая логика состояния React
│       └── services/            # Браузерные запросы и проверка ответов
├── backend/
│   ├── prisma/                  # Схема, миграции и начальные данные
│   └── src/                     # Источники, нормализаторы и бизнес-правила
├── tests/                       # Unit, интеграции PostgreSQL, браузерные сценарии
├── scripts/                     # CLI, фоновые задачи и сопровождение
├── docs/                        # Архитектура, проверка качества и эксплуатация
├── deploy/                      # Шаблоны фоновых служб
├── .env.example                 # Шаблон настроек без рабочих секретов
├── docker-compose.yml
└── package.json                 # Единые зависимости и команды
```

**Стек:** Node.js 24 · Next.js 16.3 · React 19 · TypeScript · PostgreSQL 16 · Prisma 5 · Tailwind CSS. Для парсинга используются Cheerio и Playwright, для изображений и OCR — Sharp и Tesseract.js. Версии зависимостей закреплены в [package-lock.json](package-lock.json).

## Локальный запуск

Понадобятся **Node.js 24**, npm и PostgreSQL 16. Базу можно запустить через Docker Compose; для полного набора проверок также нужен PowerShell (`powershell.exe` на Windows или `pwsh` на Linux/macOS).

### 1. Установить зависимости

```bash
git clone https://github.com/inftverezovsky/TData.git
cd TData
npm ci
npx playwright install chromium
```

Все дальнейшие команды выполняются из корня `TData`.

### 2. Подготовить настройки

Создайте `.env` в корне клона из [.env.example](.env.example), если файла ещё нет. Например, для клона в `C:\projects\TData` полный путь — **`C:\projects\TData\.env`**; на Linux — **`/home/user/projects/TData/.env`**. Этот файл уже исключён из Git.

PowerShell:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Linux/macOS:

```bash
test -f .env || cp .env.example .env
```

Замените placeholders в локальном `.env`. Для базы из Compose настройки подключения должны совпадать:

```dotenv
POSTGRES_USER=tdata
POSTGRES_PASSWORD=CHANGE_ME_DB_PASSWORD
POSTGRES_DB=tdata
POSTGRES_PORT=5434
DATABASE_URL="postgresql://tdata:CHANGE_ME_DB_PASSWORD@localhost:5434/tdata?schema=public"

LIQUIPEDIA_USER_AGENT="tdata-local/1.0 (contact: you@example.com)"
ADMIN_PASSWORD=CHANGE_ME_ADMIN_PASSWORD
ADMIN_SESSION_SECRET=CHANGE_ME_LONG_RANDOM_SECRET
ADMIN_UPLOAD_ALLOWED_HOSTS=admin.example.com

# Локальный HTTP и ручная настройка фоновых задач.
ADMIN_COOKIE_SECURE=false
KHL_RESULTS_AUTO_SYNC_ENABLED=0
TLINE_ENABLED=0
TLINE_SCHEDULER_READY=0
```

Пароль в `DATABASE_URL` должен быть URL-кодирован, если содержит специальные символы. Настоящие секреты хранятся в локальном `.env` или хранилище секретов среды развёртывания. Для HTTPS устанавливается `ADMIN_COOKIE_SECURE=true`.

`ADMIN_UPLOAD_ALLOWED_HOSTS` задаёт разрешённые домены внешней отправки; `admin.example.com` — пример. Для AI-распознавания дополнительно задаётся `ARCCODEX_API_KEY` в том же `.env`. Способы авторизации внешнего Admin API описаны в [политике API](docs/API_POLICY.md).

### 3. Запустить базу и приложение

Для PostgreSQL из Compose:

```bash
docker compose up -d --wait postgres
```

Если PostgreSQL уже запущен, укажите его адрес и заранее созданную базу в `DATABASE_URL`. Затем:

```bash
npm run prisma:generate
node --env-file=.env --run db:migrate:deploy
node --env-file=.env --run db:seed
node --env-file=.env --run dev
```

Node.js явно загружает корневой `.env` перед выполнением скрипта из `package.json`. Это также передаёт настройки приложению, которое Next.js запускает из каталога `frontend`.

Seed создаёт или обновляет базовые киберспортивные дисциплины и добавляет пилотную конфигурацию TLine для волейбола, флорбола и хоккея. Повторный запуск сохраняет уже настроенные параметры пилотов; автоматические проверки новых конфигураций отключены. Код: [backend/prisma/seed.ts](backend/prisma/seed.ts), [bootstrap пилотов](backend/src/tline/pilot/bootstrap.ts).

Откройте **[http://localhost:3010](http://localhost:3010)**. Для настроек API и отправки используйте пароль из `ADMIN_PASSWORD`. Доступная PostgreSQL нужна и для входа: в ней хранится общий лимит попыток.

<details>
<summary><strong>Запуск всех сервисов в Docker</strong></summary>

После заполнения того же корневого `.env`:

```bash
docker compose config -q
docker compose up -d --build --wait
docker compose exec web npm run db:seed
docker compose ps
```

Контейнер `web` применяет существующие миграции при старте. По умолчанию приложение доступно на `127.0.0.1:3010`, PostgreSQL — на `127.0.0.1:5434`. Порты задаются через `WEB_PORT` и `POSTGRES_PORT`; локальный dev-сервер и контейнер `web` не могут одновременно занять один порт.

Развёртывание на сервере, HTTPS, резервное копирование и откат описаны в [инструкции эксплуатации](docs/DEPLOYMENT_PORTAINER.md).

</details>

## Проверки и команды

Быстрая проверка кода без рабочей PostgreSQL:

```bash
npm run check
npm run build
```

| Команда                             | Назначение                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`                       | Dev-сервер на порту 3010; для настроек из корневого `.env` используйте вариант выше. |
| `npm run build`                     | Генерация Prisma Client и production-сборка Next.js.                                 |
| `npm run start`                     | Запуск готовой сборки; порт задаётся через `PORT` или аргумент `-p`.                 |
| `npm run check`                     | Prisma Client, TypeScript, строгий ESLint и unit/API-тесты без БД.                   |
| `npm run test:integration`          | Интеграционные тесты на отдельной PostgreSQL.                                        |
| `npm run test:e2e:prod`             | Браузерные проверки готовой production-сборки.                                       |
| `npm run test:e2e:db`               | Проверка FIxt с тестовой БД и локальным mock Admin API.                              |
| `npm run test:frontend:coverage`    | Покрытие выбранных frontend-моделей и сервисов.                                      |
| `npm run test:normalizers:coverage` | Покрытие нормализаторов турнирных данных.                                            |
| `npm run test:tline:coverage`       | Покрытие выбранных модулей TLine.                                                    |
| `npm run test:consultant:coverage`  | Покрытие приватного Telegram-консультанта.                                           |
| `npm run test:all`                  | Полный локальный набор после подготовки тестовой среды.                              |
| `npm run format:check -- README.md` | Проверка форматирования указанного файла.                                            |

Для DB/E2E-проверок подготовьте **отдельную локальную тестовую базу**, миграции, seed и переменные `TEST_DATABASE_URL` / `DATABASE_URL` по [инструкции тестирования](docs/TESTING.md). Рабочую базу для этих сценариев использовать нельзя.

Порог 80% применяется к выбранным модулям в командах coverage, а не ко всему проекту. Зафиксированные результаты проверок и границы аудита приведены в [отчёте от 07.09.2026](docs/AUDIT_2026-09-07.md).

Фоновые процессы запускаются отдельно от веб-интерфейса: `npm run worker:tline` обрабатывает проверки линии, `npm run monitor:parsers` проверяет источники, `npm run consultant:telegram` запускает приватного консультанта. Перед запуском подготовьте настройки и секреты по соответствующим инструкциям ниже; обычный запуск `dev` не включает эти службы.

## Документация

| Документ                                                      | Когда открыть                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [Архитектура](docs/ARCHITECTURE.md)                           | Понять границы frontend/backend, обработку данных и ответственность каталогов. |
| [Путеводитель по коду](docs/CODE_GUIDE.md)                    | Найти точки входа и основные алгоритмы.                                        |
| [Frontend](frontend/README.md) · [Backend](backend/README.md) | Разобраться в конкретном слое приложения.                                      |
| [Проверка качества](docs/TESTING.md)                          | Запустить unit, DB, E2E и coverage в подходящем окружении.                     |
| [Политика API](docs/API_POLICY.md)                            | Настроить сессии, внешние запросы и ограничения доступа.                       |
| [TLine](docs/TLINE.md)                                        | Настроить сверку линии и фоновые проверки.                                     |
| [Результаты КХЛ](KHL_HANDOFF.md)                              | Изучить версии, статистику, привязки и staging.                                |
| [Фоновые службы](deploy/systemd/README.md)                    | Настроить синхронизацию КХЛ, мониторинг парсеров и уведомления.                |
| [Telegram-консультант](docs/TELEGRAM_CONSULTANT.md)           | Подключить приватного бота, ограничить расходы и проверить его состояние.      |
| [Развёртывание](docs/DEPLOYMENT_PORTAINER.md)                 | Подготовить конфигурацию сервера и порядок выкладки.                           |
| [Отчёт аудита](docs/AUDIT_2026-09-07.md)                      | Посмотреть исправления, проверенные сценарии и эксплуатационные ограничения.   |

GitHub Actions настроен на проверку качества и сборку Docker-артефакта. Фактические запуски доступны во вкладке [Actions](https://github.com/inftverezovsky/TData/actions); публикация кода в GitHub сама по себе не обновляет сервер.
