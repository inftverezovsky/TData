# TCYBER: Advanced Esport Data Engine - Project Documentation

This document provides a comprehensive overview of the **TCYBER** project, designed for AI coding assistants (like Codex, Claude, Cursor) to quickly grasp the project's architecture, domain logic, tech stack, and specific technical nuances.

## 1. Project Domain & Purpose
**TCYBER** is a high-performance, fault-tolerant internal engine designed to parse, normalize, and map esports tournament data (Counter-Strike, Dota 2, League of Legends, Valorant) from external sources (primarily **Liquipedia** via MediaWiki API and **HLTV** via scraping) and export this data to an external Admin API.

**Core Workflow:**
1. **Fetch:** Retrieve Raw Wikitext/HTML from Liquipedia/HLTV (with proxy rotation & rate-limiting).
2. **Normalize:** Parse Wikitext into structured JSON using discipline-specific normalizers.
3. **Deduplicate:** Clean up duplicate rounds, matches, and stages.
4. **Fuzzy Match (Mapping):** Map external team names (e.g., from Liquipedia) to internal database IDs using Levenshtein distance and aliases.
5. **Export:** Serialize the tournament matches into specific formats (e.g., PHP arrays) and send them to a legacy Admin API via mTLS.

## 2. Tech Stack
- **Framework:** Next.js 16 (App Router, Server Actions, API routes)
- **Language:** TypeScript (Strict mode)
- **Database / ORM:** PostgreSQL + Prisma (`@prisma/client` v5.22.0)
- **Styling:** Tailwind CSS + Framer Motion (for dynamic UI) + `clsx`/`tailwind-merge`
- **Testing:** 
  - Unit: Node.js native test runner (`tsx --test`)
  - E2E: Playwright (`@playwright/test`)
- **Parsing & Data Processing:**
  - `cheerio` (HTML parsing for HLTV)
  - `tesseract.js` (OCR capabilities, if any)
  - `fast-levenshtein` (Fuzzy matching algorithms)
  - `luxon` (Timezone and Date management)
- **Network & Scraping:**
  - Custom proxy rotation (`https-proxy-agent`, `socks-proxy-agent`, `proxy-chain`)
  - `puppeteer-extra-plugin-stealth`

## 3. Directory Structure (Clean Architecture)
The project strictly separates domain logic from the presentation layer.

```text
liquipedia/
├── prisma/                # Prisma schema (schema.prisma) and seed scripts
├── scripts/               # Automation scripts (e.g., tcyber-cli.ts for dev ops)
├── src/
│   ├── app/               # Next.js 16 App Router (Dynamic routing based on `[disciplineSlug]`)
│   │   ├── [disciplineSlug]/         # Hub for specific discipline
│   │   ├── api/                      # REST API endpoints (Admin, Search, Sync)
│   │   └── settings/                 # Global settings & Proxy dashboard
│   ├── components/        # React Components
│   │   ├── admin/         # UI for data import / management
│   │   ├── hltv/          # HLTV specific UI
│   │   ├── tournament/    # Tournament mapping dashboard & fixture sending UI
│   │   └── ui/            # Reusable UI elements (Design System)
│   └── lib/               # Business Logic & Domain Services (The core engine)
│       ├── adminUpload/   # Serializing payloads (PHP Arrays) and mTLS upload logic
│       ├── db/            # Prisma client instance
│       ├── hltv/          # HLTV scraping logic
│       ├── liquipedia/    # MediaWiki API client & Rate Limiter
│       ├── matches/       # Match deduplication and data quality validation
│       ├── normalizers/   # Discipline-specific Wikitext parsers (Dota2, CS, LoL, Valorant)
│       ├── sync/          # Identity Sync (Prod to Local DB sync)
│       ├── teams/         # Fuzzy matching & Levenshtein engine
│       └── utils/         # Math, string manipulation, dates
├── tests/                 # Unit tests (run via `npm test`)
```

## 4. Architectural Nuances & "Gotchas"

### 4.1. Dynamic Routing & Strategy Registry
Almost the entire application is driven by the `disciplineSlug` (e.g., `counterstrike`, `dota2`).
Instead of hardcoding logic, the system uses a **Strategy Registry** in `src/lib/normalizers/`. When a user requests to import a Dota 2 tournament, the router dynamically delegates the raw Wikitext to the `Dota2Normalizer`, which handles game-specific quirks (like empty TBD playoff slots or specific bracket formats).

### 4.2. Fuzzy Match Engine & Team Canonicalization
Liquipedia team names are notoriously inconsistent (e.g., "Natus Vincere" vs "Na'Vi" vs "NAVI").
The `lib/teams/` module uses `fast-levenshtein`. 
- **DB Model `TeamMapping`**: Stores relationships between `liquipediaName` and `platformId`.
- **Status Enum**: `unmapped`, `auto_mapped`, `manual_mapped`, `ignored`.
- **Nuance**: The engine prefers saving mappings permanently. If a team name has high noise (OCR errors or weird formatting), the fuzzy matcher assigns a `confidenceScore`. Only high confidence gets auto-mapped.

### 4.3. Proxy Pool & External Fetching
Because Liquipedia and HLTV aggressively rate-limit or ban IPs, TCYBER uses a custom proxy manager.
- **DB Model `ProxyPool`**: Tracks active proxies, `failCount`, `blockedCount`, and `cooldownUntil`.
- **DB Model `SourceFetchCache`**: Caches raw API responses to prevent redundant requests and bans.
- **Admin Dashboard**: Exposes the health of the proxy pool and a `ParserRequestLog` to monitor Cache Hits vs Live Fetches.

### 4.4. Legacy Admin API Integration (adminUpload)
When exporting a parsed tournament to the final Admin API, TCYBER must adhere to specific legacy requirements:
- **DB Model `DisciplineAdminSettings`**: Stores the target API URL, `adminSportId`, `timezone`, and `requestMode`.
- **Serialization**: The payload often needs to be serialized into a specific format (e.g., nested PHP arrays or `urlencoded` strings) instead of modern JSON.
- **mTLS**: The export uses Mutual TLS. Client certificates are located in the `certs/` directory (ignored by git).
- **Timezones**: Handled carefully via `luxon`, strictly abiding by the `timezone` and `dateFormat` set in `DisciplineAdminSettings`.

### 4.5. CLI Tool
There is a developer CLI (`scripts/tcyber-cli.ts`) executed via `npx tsx scripts/tcyber-cli.ts`. It is used for DB checks, clearing cache, proxy checks, and deployment health tests. If you need to debug the proxy pool or clear the cache, use this CLI.

## 5. Core Database Models (Prisma)

- **`Discipline`**: Root entity (e.g., CS, Dota2).
- **`Tournament`**: Normalized tournament entity. Contains `extractionStatus` (`PENDING`, `PARTIAL`, `SUCCESS`).
- **`TournamentMatch`**: Contains match details, `matchDate`, `teamAId`, `teamBId`, `scoreA`, `scoreB`. Includes `lpNumericalId` for Liquipedia deduplication.
- **`TournamentParticipant`**: Teams participating in the tournament.
- **`RawSnapshot`**: Stores the raw JSON/Wikitext fetched from the source (for auditing and re-parsing).
- **`TeamMapping`**: The crucial mapping table resolving string names to internal platform IDs.
- **`SourceFetchCache`**: The request cache for MediaWiki API and HTML scrapes.
- **`AdminUploadLog`**: Audit log of everything sent to the external legacy Admin API (including the serialized string and API response).

## 6. How to Contribute / Rules for Codex
1. **Strict TypeScript**: Always type variables and avoid `any`. Use Prisma generated types where applicable.
2. **Do Not Break Normalizers**: If modifying how Wikitext is parsed, ensure `npm test` passes. The 52+ unit tests cover edge cases like TBD slots, duplicate matches, and Valorant subpages.
3. **App Router Conventions**: Use Next.js 16 conventions (Server Components by default, `"use client"` only when React hooks are needed). Data fetching should be handled server-side where possible.
4. **Resiliency**: When interacting with external APIs (Liquipedia/HLTV), ALWAYS use the internal caching & proxy wrapper mechanisms. Never use raw `fetch` directly to Liquipedia.
5. **Separation of Concerns**: Keep React components "dumb" and place business logic (like data transformation or Levenshtein scoring) in `src/lib/`.
6. **Discipline Sync Rule**: When adding a new sport/discipline to parsing, manual import, or the main discipline panels, also add the same discipline scope to the Admin Team Importer discipline list so team ID dictionaries can be imported for it. Beach volleyball is split into `beachvolleyball-men` (`Пляжный волейбол (м)`) and `beachvolleyball-women` (`Пляжный волейбол (ж)`).
7. **TBvolley Settings Rule**: When adding a new TBvolley source/provider, also add its controls to the TBvolley block in Settings (`src/components/settings/TBvolleyGlobalSettings.tsx`) and mention it in the TBvolley accordion subtitle on `src/app/settings/page.tsx`.
