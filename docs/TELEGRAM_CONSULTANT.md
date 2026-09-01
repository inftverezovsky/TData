# Telegram consultant

`tdata-telegram-consultant` is a private, read-only TData assistant. It receives
messages only from the configured Telegram chat, retrieves a few relevant chunks
from an allowlist of canonical project documentation, and sends that bounded
context to DeepSeek. It has no commands that mutate application or server state.

## Cost controls

- Model: `deepseek-v4-flash`, with thinking disabled.
- No conversation history, embeddings, fine-tuning, or full-document uploads.
- At most four local documentation chunks and 8,000 user-prompt characters.
- Default daily limits: 12 calls, 30,000 input tokens, 5,000 output tokens.
- Maximum answer: 450 tokens; maximum question: 1,500 characters.
- Repeated questions reuse a short-lived in-memory response cache.
- `/status`, `/parsers`, `/docs`, `/budget`, and `/help` do not call DeepSeek.

The persistent state contains only the Telegram update offset, aggregate daily
token usage, and the last successful poll time. Questions and answers are not
written to disk.

## Production secret

Create `/etc/tdata/telegram-consultant.env` if it does not exist. It is outside
Git and must be owned by `root:root` with mode `0600`:

```dotenv
TDATA_TELEGRAM_CONSULTANT_DEEPSEEK_API_KEY=<deepseek-api-key>
```

The existing `/etc/tdata/parser-monitor.env` supplies these values without
duplicating them:

```dotenv
TDATA_PARSER_MONITOR_TELEGRAM_BOT_TOKEN=<telegram-bot-token>
TDATA_PARSER_MONITOR_TELEGRAM_CHAT_ID=<numeric-chat-id>
```

Never paste real values into chat, Git, shell command arguments, or logs. Populate
the file through an interactive editor or an approved secret-delivery mechanism.

## Start and verify

Before enabling long polling, `getWebhookInfo` must report an empty webhook URL.
The worker intentionally refuses to delete or replace an existing webhook.

Load the two secret files into the current shell without printing their contents,
then include the override after the production compose files:

```bash
set -a
. /etc/tdata/parser-monitor.env
. /etc/tdata/telegram-consultant.env
set +a
docker compose -p tdata -f docker-compose.yml -f deploy/compose/tdata-telegram-consultant.yml up -d telegram-consultant
unset TDATA_PARSER_MONITOR_TELEGRAM_BOT_TOKEN TDATA_PARSER_MONITOR_TELEGRAM_CHAT_ID TDATA_TELEGRAM_CONSULTANT_DEEPSEEK_API_KEY
docker inspect --format '{{.State.Health.Status}}' tdata-telegram-consultant
docker logs --tail 50 tdata-telegram-consultant
```

Logs contain sanitized error classes only. The worker uses the existing proxy pool
for Telegram/DeepSeek fallback and stores state in the existing `tdata_cache`
volume under `/app/cache/telegram-consultant`.
