# Tournament Audit Agent

The tournament audit agent checks upcoming tournaments across the platform sources and reports cases where a source appears to have matches or announcements but the platform has none after import.

Run:

```bash
npm run audit:tournaments -- --days 10
```

Useful options:

```bash
npm run audit:tournaments -- --days 10 --force-events
npm run audit:tournaments -- --days 10 --force-import
npm run audit:tournaments -- --days 10 --source liquipedia
npm run audit:tournaments -- --discipline dota2
```

Default behavior is conservative: event lists are read from cache when available and imports are not force-refreshed. Use `--force-events` to refresh tournament lists, and `--force-import` only when you intentionally want the importer to clear source caches and reload each tournament from scratch.

The agent writes two reports under `.codex-logs/tournament-audit/`:

- `*.json` contains complete machine-readable details.
- `*.md` contains the investigation report with source URLs, platform URLs, counts, warnings, and diagnostic issues.

Training goal:

1. Collect upcoming and ongoing tournaments for the next N days across Liquipedia, HLTV, VLR, DLTV, and Fandom.
2. Import each tournament through the same import code used by the app.
3. Open the persisted platform state and count upload-ready matches plus generated announcement entries.
4. Compare that state with source diagnostics and raw schedule signals.
5. Report every tournament where the source has schedule evidence but the platform is empty, or where parser/import diagnostics show candidates were skipped.
