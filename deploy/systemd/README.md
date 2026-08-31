# Automatic KHL results sync

The service reads only the official KHL API and stores completed match protocols. It never
sends results to Admin. The application enforces a fixed lower bound of `2026-05-01T00:00:00Z`.

Install on the TData host after the new `tdata-web` image is healthy:

```sh
install -m 0644 deploy/systemd/tdata-khl-results-sync.service /etc/systemd/system/
install -m 0644 deploy/systemd/tdata-khl-results-sync.timer /etc/systemd/system/
systemctl daemon-reload
docker exec tdata-web npm run sync:khl-results -- --full --refresh-hours 0
systemctl enable --now tdata-khl-results-sync.timer
```

Read-only checks:

```sh
systemctl status tdata-khl-results-sync.timer --no-pager
systemctl list-timers tdata-khl-results-sync.timer --no-pager
journalctl -u tdata-khl-results-sync.service -n 100 --no-pager
```

Scheduler rollback (does not delete any KHL data):

```sh
systemctl disable --now tdata-khl-results-sync.timer
```
# Parser reliability monitor

The parser monitor is read-only with respect to tournament/import data. It performs fresh discovery and semantic canaries, stores reports in the existing `/app/cache` Docker volume, and alerts only when the failure set changes or fully recovers.

Create `/etc/tdata/parser-monitor.env` on the server if it does not exist. This file is outside Git and must remain secret:

```dotenv
TDATA_PARSER_MONITOR_TELEGRAM_BOT_TOKEN=<telegram-bot-token>
TDATA_PARSER_MONITOR_TELEGRAM_CHAT_ID=<numeric-chat-id>
```

Set ownership and permissions without printing its contents:

```bash
chown root:root /etc/tdata/parser-monitor.env
chmod 600 /etc/tdata/parser-monitor.env
```

Do not paste either value into chat, source files, shell command arguments, Git, or systemd unit files. Populate the file through an interactive editor or another approved secret-delivery mechanism.

Install and validate the units:

```bash
install -o root -g root -m 0644 deploy/systemd/tdata-parser-monitor.service /etc/systemd/system/tdata-parser-monitor.service
install -o root -g root -m 0644 deploy/systemd/tdata-parser-monitor.timer /etc/systemd/system/tdata-parser-monitor.timer
systemd-analyze verify /etc/systemd/system/tdata-parser-monitor.service /etc/systemd/system/tdata-parser-monitor.timer
systemctl daemon-reload
```

Before enabling notifications, run the canary without Telegram:

```bash
docker exec tdata-web npm run monitor:parsers -- --notify=never --report-dir=/app/cache/parser-monitor
docker exec tdata-web sh -lc 'test -s /app/cache/parser-monitor/latest.json'
```

After the user has installed the two secret values and explicitly approved a test notification, send exactly one test message. This mode does not run probes and does not change the incident fingerprint:

```bash
set -a
. /etc/tdata/parser-monitor.env
set +a
docker exec -e TDATA_PARSER_MONITOR_TELEGRAM_BOT_TOKEN -e TDATA_PARSER_MONITOR_TELEGRAM_CHAT_ID tdata-web npm run monitor:parsers -- --notify=test
unset TDATA_PARSER_MONITOR_TELEGRAM_BOT_TOKEN TDATA_PARSER_MONITOR_TELEGRAM_CHAT_ID
```

Then start the service once and inspect the sanitized journal:

```bash
systemctl start tdata-parser-monitor.service
systemctl status tdata-parser-monitor.service --no-pager
journalctl -u tdata-parser-monitor.service -n 100 --no-pager
```

Enable the Friday 18:00 Europe/Moscow timer only after the one-shot run is accepted:

```bash
systemctl enable --now tdata-parser-monitor.timer
systemctl list-timers tdata-parser-monitor.timer --no-pager
```

Reports are written atomically as `latest.json`, timestamped `.json`/`.md`, and `state.json` under `/app/cache/parser-monitor`. Timestamped reports older than 90 days are pruned. The public `/api/health` endpoint intentionally remains independent from external parser availability; authenticated `/api/admin/health` includes the latest monitor report.

The command exits with `0` only when every required source is `healthy` or `healthy_empty`, `1` when at least one required source remains `warning` or `failed` after retries, and `2` for runner/configuration failures such as an unavailable database, unwritable report volume, or missing Telegram configuration in `--notify=telegram` mode.

The service invokes the direct `tsx` runner rather than an npm wrapper and runs it under GNU `timeout` without `--foreground`. At 58 minutes `timeout` sends `TERM` to its separate in-container process group. The runner handles `SIGTERM`/`SIGINT`, propagates one abort signal through active probes and retry waits, and waits for adapter cleanup (including the detached HLTV browser process group) before exiting. If graceful cleanup does not finish, `timeout` escalates to `KILL` after 30 seconds. `TimeoutStartSec=60min` remains the outer limit for the host-side `docker exec` service process.
