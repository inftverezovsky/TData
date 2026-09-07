# API policy

Проект использует Liquipedia только как API-источник. HTML scraping запрещён внутри этого проекта.

## Allowed flow

```text
User clicks button → MediaWiki API request → raw snapshot → normalizer → database → UI
```

## Not allowed

```text
Background crawler → generated HTML pages → DOM parsing → database
```

## Rate limiting

В проекте есть in-memory limiter:

- generic requests: `LIQUIPEDIA_GENERIC_MIN_INTERVAL_MS`, по умолчанию `2100 ms`;
- parse requests: `LIQUIPEDIA_PARSE_MIN_INTERVAL_MS`, по умолчанию `31000 ms`.
- random jitter: `LIQUIPEDIA_JITTER_MS`, по умолчанию `650 ms`;
- cooldown after 429/Cloudflare blocks: `LIQUIPEDIA_COOLDOWN_MS`, по умолчанию `600000 ms`.

По умолчанию `LIQUIPEDIA_SKIP_PARSED_HTML=1`: дорогой `action=parse` пропускается.
При значении `0` импорт может запросить parsed HTML через MediaWiki API;
это отличается от обхода сгенерированных публичных HTML-страниц.

HLTV Playwright tasks are queued and additionally spaced by `HLTV_QUEUE_DELAY_MS`, по умолчанию `1000 ms`.

## User-Agent

Перед реальным использованием нужно заменить:

```env
LIQUIPEDIA_USER_AGENT="liquipedia-local-dev/0.1 (https://your-domain.example; your-email@example.com)"
```

В production используйте стабильный contactable User-Agent; MediaWiki API запросы не должны маскироваться под браузер.

## Caching

Поиск кешируется через таблицы `search_requests` и `search_results`.

Импорт турнира создаёт новый `tournament_import` и новый `raw_snapshot`, потому что пользователь явно нажимает кнопку обновления.

## Attribution

Каждый нормализованный турнир хранит:

- `sourceTitle`
- `sourceUrl`
- `sourcePageId`

UI показывает ссылку на Liquipedia source.
