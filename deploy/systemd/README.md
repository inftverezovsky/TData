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
