# TData Architecture

TData is a tournament operations platform. The codebase is organized around clear runtime boundaries:

- `src/app` contains Next.js routes, pages, and API handlers. API routes should stay thin: validate input, call domain services, and return HTTP responses.
- `src/components` contains React UI only. Components may call browser APIs and fetch app endpoints, but should not read Prisma, filesystem, or server-only configuration directly.
- `src/lib` contains domain logic, integrations, and pure utilities. Shared algorithms live here so they can be reused by API routes, UI sandboxes, scripts, and tests.
- `prisma` owns database schema, migrations, and seed data.
- `scripts` contains intentional operational tooling such as deploy helpers, audits, imports, and maintenance commands.
- `tests` mirrors domain behavior and integration surfaces. New cross-module behavior should be covered here before deployment.

## Domain Boundaries

- `adminUpload`: FIxt payload formatting, upload policy, admin HTTP client, and admin-specific settings resolution.
- `adminTeams`: admin team import parsing, spreadsheet loading, and sandbox dry-runs.
- `teams`: canonicalization, fuzzy matching, mapping lookup, and pure automapping preview.
- `matches`: schedule display policy, date/time handling, dedupe, quality, and announcement offsets.
- `sources`: external source clients, parsers, and import adapters. Cyber source adapters currently live under the legacy `sources/TCyber` namespace; volleyball sources live under `sources/tbvolley`.
- `imports`: tournament import dispatch/orchestration that keeps API routes thin while preserving public route URLs.
- `normalizers`: Liquipedia wikitext/html normalization by discipline.
- `settings`, `auth`, `proxy`, `sync`, `http`, `cache`, `db`: infrastructure and platform services.

## Source Layout

```text
src/lib/sources/
  TCyber/
    liquipedia/
    hltv/
    dltv/
    vlr/
    fandom/
  tbvolley/
    VolleyballWorld/
    beach.volley.ru/
    GermanBeachTour/
    config.ts
    genderSwitchCache.ts
```

Each source folder should keep its source-specific client/parser code close to its import adapter. Shared cross-source helpers stay directly under `src/lib/sources`.

## Coupling Rules

- UI components must not import Prisma or filesystem modules.
- API routes should import domain services, not large UI modules.
- Source parsers must not call admin upload code directly. They produce normalized matches; upload policy decides what can be sent.
- Automapping algorithms must remain database-free unless the function name explicitly says it applies or saves data.
- Secrets and external admin endpoints must stay out of tracked source files. Use `.env` or runtime platform settings.
- Temporary diagnostics belong in ignored folders such as `.codex-logs`, `scratch`, or `test-results`, not in tracked source.

## Cleanup Policy

Remove a file when all of these are true:

- it is not imported by `src`, `tests`, `scripts`, or `prisma`;
- it is not a Next.js route/page/layout/error/loading entrypoint;
- it is not referenced by package scripts, deployment scripts, or documentation;
- typecheck, lint, tests, and build stay green after removal.

For admin integrations, never keep real URLs, keys, tokens, certificates, or response bodies in git. Logs may keep counters and statuses, but should avoid raw external API responses.
