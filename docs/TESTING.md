# Проверка качества

Все команды выполняются из корня проекта на Node.js 24. Зависимости закреплены
в `package-lock.json`; использовать `npm ci`, а не обновлять их при каждом запуске.

## Быстрая проверка без PostgreSQL

```bash
npm ci
npm run check
```

`check` генерирует Prisma Client, затем запускает TypeScript, ESLint без допустимых
предупреждений и `tests/*.test.ts`. Это тесты чистых правил и HTTP-адаптеров
с подменёнными внешними зависимостями. Они не требуют рабочей `.env` или живого
спортивного сайта. Генерация Prisma не применяет миграции.

## Тесты настоящей БД

`tests/integration/` содержит сценарии, создающие и удаляющие записи.
Они запускаются последовательно и требуют `TEST_DATABASE_URL`.
Проверка адреса происходит до создания PrismaClient.

Разрешён только PostgreSQL на `localhost`, `127.0.0.1` или `::1`, схема `public`
и имя `tdata_test_*`, `tdata_khl_test_*` либо `tdata_khl_browser_*`.
Параметры URL, подменяющие host или схему, отклоняются. Одного слова `test`
в пароле, имени пользователя или `application_name` недостаточно.

Пример для **уже созданной отдельной локальной базы** с trust-аутентификацией
только на loopback; строка ниже не содержит пароля:

```powershell
$env:DATABASE_URL = 'postgresql://postgres@127.0.0.1:54329/tdata_test_local?schema=public'
$env:TEST_DATABASE_URL = $env:DATABASE_URL
npm run db:migrate:deploy
npm run test:integration
npm run db:seed
```

Эти команды применяют миграции и данные только к базе, которую вы указали.
Не подставлять рабочее подключение. Если локальной БД нужен пароль, задавать
переменные в runtime безопасным способом; не вставлять пароль в команды,
документацию или чат. Никаких новых секретных файлов тесты не требуют.

## Браузерные сценарии

```bash
npx playwright install chromium
npm run build
npm run test:e2e:prod
```

`test:e2e:prod` запускает production build на loopback; `test:e2e` запускает
dev server. Проверяются навигация, настройки, ручной импорт и TLine.
Проект `mobile-smoke` использует размер экрана Pixel 5. Это проверки Chromium,
а не подтверждение совместимости со всеми браузерами.

Playwright не наследует рабочую БД из `.env`: либо используется явно проверенная
`DATABASE_URL`, либо недоступный локальный тестовый адрес. Полный набор
требует заранее подготовленную отдельную базу и seed: реальный вход проверяет
общий лимит попыток в PostgreSQL. При недоступной БД вход возвращает 503.
Фоновые TLine/KHL-задачи в тестовом web server отключены.

```bash
npm run test:e2e:db
```

Отдельный FIxt DB E2E требует безопасную `DATABASE_URL`, поднимает локальный mock
Admin API и проверяет payload, журналирование и блокирование повторной отправки.
В этом процессе используется production build; HTTP/private host разрешены
**только для loopback mock**, наследование рабочей авторизации/mTLS отключено.
Обычный smoke-запуск явно пропускает этот сценарий.

`test-results/` и `playwright-report/` содержат временные trace/screenshot
диагностики, исключённые из Git. Не прикладывать к отчёту trace с рабочими секретами.

## Покрытие

```bash
npm run test:tline:coverage
npm run test:normalizers:coverage
npm run test:frontend:coverage
npm run test:consultant:coverage
```

Команды проверяют ядро TLine, нормализаторы и чистые frontend-модели/сервисы
с порогом 80% по строкам, ветвям и функциям.
Это **не глобальное покрытие всего TData**. В отчёте аудита указаны фактические
области измерения. Новое поведение проверять регрессионным тестом; чистое
перемещение кода — существующими тестами плюс E2E соответствующего сценария.
Тесты на календарные фильтры фиксируют время, чтобы не ломаться через месяц.

## CI

`.github/workflows/quality.yml` проверяет pull request и может запускаться вручную.
Он поднимает PostgreSQL 16, выполняет static/unit/DB/coverage/build и браузерные
проверки. `build-production-image.yml` вызывает этот workflow перед сборкой
production-архива и автоматической выкладкой актуального `main` через ограниченный
SSH-доступ. Порядок обновления и восстановления описан в
[AUTO_DEPLOY.md](AUTO_DEPLOY.md); результат каждого push виден в GitHub Actions.

Сценарии автоматической выкладки и установщика проверяются без доступа к серверу:

```bash
python3 -m unittest discover -s tests -p 'test_auto_deploy.py' -v
python3 -m unittest discover -s tests -p 'test_configure_autodeploy.py' -v
```

`npm run test:all` — полный локальный набор. Перед ним должны быть готовы тестовая
БД, обе переменные подключения, миграции, seed и Chromium.

## Повторная проверка замечаний аудита

- `tests/adminCredentialStorage.test.ts`, `tests/adminSessionSecurity.test.ts`
  и `tests/integration/adminLoginRateLimit.test.ts` проверяют хеширование,
  отзыв сессии и общий лимит параллельных попыток входа.
- `tests/adminOutboundTransport.test.ts`, `tests/proxyHealthProbe.test.ts`
  проверяют настоящий HTTP/HTTPS/mTLS/CONNECT на loopback без внешней сети.
- `tests/integration/liquipediaSafeRefresh.test.ts` проверяет сохранность данных
  при force, отказе вставки и неполном новом результате.
- `tests/e2e/tline-settings-recovery.spec.ts` воспроизводит сбой загрузки и
  сохранения формы; введённые значения должны оставаться до успешного повтора.
- `tests/deploymentScripts.test.ts` проверяет offline defaults, параметры и
  resolved Compose. Для него нужен PowerShell: `powershell.exe` на Windows,
  `pwsh` на Linux/macOS. Bash-сценарии приведены в
  [инструкции deploy](DEPLOYMENT_PORTAINER.md); они не запускают Docker/SSH.
- `npm audit` проверяет текущие advisories для зависимостей в lockfile.

Проверка rollback в mock-окружении не заменяет проверку реального Docker daemon
и резервного восстановления перед отдельной production-выкладкой.
