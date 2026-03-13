# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MyPantry / Pantry Clip** is a privacy-first, hybrid recipe assistant. It is a monorepo with two main apps:

- **`apps/extension`** — A Manifest V3 Chrome extension built with Astro
- **`apps/api`** — A FastAPI Python backend acting as a secure LLM proxy and cloud sync router

Package managers: `pnpm` for the extension workspace, `uv` for the Python API.

## Commands

### Extension (`apps/extension`)

```bash
pnpm ext:build          # Production build → apps/extension/dist/
pnpm ext:dev            # Dev server (downloads model first via predev hook)
pnpm ext:test           # Unit tests (vitest)
pnpm ext:test:chromium  # Run in Chromium via web-ext
pnpm ext:test:firefox   # Run in Firefox via web-ext
pnpm ext:zip            # Zip dist/ for store submission
```

Running a single unit test:
```bash
cd apps/extension && pnpm vitest run tests/extension/test_crypto.test.ts
```

### API (`apps/api`)

```bash
pnpm api:dev            # Start FastAPI dev server on :8000
pnpm api:test           # Run pytest against tests/api/
pnpm api:kill           # Kill whatever is on port 8000
```

Running a single API test:
```bash
cd apps/api && uv run pytest ../../tests/api/test_extract.py -v
```

### Database (Supabase)

```bash
pnpm db:push    # Apply migrations
pnpm db:reset   # Reset local Supabase
pnpm db:status  # Check Supabase status
```

## Architecture

### Extension Build Pipeline

The extension is **not a standard Astro app**. The build has two separate stages:

1. **Astro** renders the HTML pages (`popup.astro`, `pantry.astro`, `recipe.astro`, `setup.astro`, `offscreen.astro`) to `dist/`.
2. **esbuild** separately bundles `background.ts` and `content.ts` directly to `dist/background.js` and `dist/content.js` (outside Astro's pipeline).

The `predev` and `prebuild` hooks run `scripts/download-model.mjs` to fetch the ONNX model before building.

### Chrome Extension Architecture

```
background.ts          — Service worker: message hub, extraction orchestration, token refresh
content.ts             — Injected into tabs: 3-tier recipe extraction (JSON-LD → DOM → Readability)
pages/offscreen.astro  — Isolated document running Transformers.js WASM for embeddings
pages/popup.astro      — Extension action popup (Pantry Clip UI)
pages/pantry.astro     — Full-tab dashboard for browsing saved recipes
pages/recipe.astro     — Full-tab single recipe view
pages/setup.astro      — Onboarding page (shown on first install)
```

**Message types** used between extension components (defined in `background.ts`):
- `START_EXTRACTION`, `GET_EXTRACTION_STATUS`, `EXTRACTION_STATUS_UPDATE`
- `GENERATE_EMBEDDING` (routed to offscreen doc)
- `ASK_SUBSTITUTION`, `SUBSTITUTION_STATUS_UPDATE`
- `SYNC_FROM_CLOUD`, `PUSH_ALL_LOCAL_TO_CLOUD`, `GET_CLOUD_LATEST`
- `AUTH_SESSION_CAPTURED`, `AUTH_COMPLETE`
- `CACHE_API_KEY`, `GET_CACHED_API_KEY`, `CLEAR_CACHED_API_KEY`

### Local Storage Architecture

- **IndexedDB** (`mypantry` database, `recipes` store, `DB_VERSION = 2`) — primary recipe storage via `utils/db.ts`
- **Orama** — in-memory vector search index, built on-demand from IndexedDB records, using `vector[384]` schema
- **`chrome.storage.local`** — credentials (`supabaseToken`, `supabaseRefreshToken`, `supabaseUrl`, `supabaseAnonKey`), `savedUrls` cache, `lastSyncAt`
- **`chrome.storage.session`** — `activeExtractions` map (survives service worker restarts but clears on browser close)

**Important:** `DB_VERSION` bump wipes all existing IndexedDB records (embeddings are model-specific). Bump only when switching embedding models.

### Embedding Model

Model: `Snowflake/snowflake-arctic-embed-s` (int4 quantized, 384 dimensions). Runs via `@huggingface/transformers` in the offscreen document. The background service worker keeps itself alive during long operations by pinging `chrome.runtime.getPlatformInfo()` every 20s.

### API Backend Structure

```
apps/api/
  main.py               — FastAPI app, CORS (chrome-extension://), router mounting
  src/config.py         — Pydantic settings (reads .env)
  src/routers/
    extract.py          — POST /api/extract/  (rate-limited)
    substitute.py       — POST /api/substitute/  (rate-limited)
    sync.py             — Recipe cloud backup CRUD
    auth.py             — /api/oauth/consent
    home.py, privacy.py — Static pages
  src/services/llm.py   — LLM calls (Gemini primary, Claude fallback)
  src/dependencies/
    auth.py             — JWT verification via Supabase
    rate_limit.py       — Upstash Redis token-bucket per user+endpoint
  src/utils/logger.py   — loguru setup
```

Rate limits are configured in `.env` via `EXTRACT_WEEKLY_LIMIT` / `SUBSTITUTE_WEEKLY_LIMIT` (default 50/week per user).

### Dual Auth Modes

- **BYOK (local):** User provides their own LLM API key, encrypted at rest in `chrome.storage.local` using `PBKDF2 + AES-GCM` (`utils/crypto.ts`). The decrypted key is cached in the service worker's memory for 1 hour.
- **Cloud:** User authenticates via Supabase Google OAuth. The access token is used as the API key for backend requests. The service worker proactively refreshes expiring JWTs before each LLM request.

### Supabase Schema

Single table `public.recipes` with columns: `id` (text PK, URL-derived slug), `user_id` (uuid FK), `recipe_json` (jsonb — full Recipe object **without** the embedding field), `created_at`, `updated_at`. Row Level Security enforces per-user access. Vectors are never stored in the cloud.

### UI Architecture

Page-level scripts live in `src/scripts/` and are imported as side-effect modules:
- `scripts/pantry/pantryController.ts` — owns all pantry page state (filtering, search, sync, bulk actions, import/export)
- `scripts/pantry/cardRenderer.ts` — pure HTML string builders for recipe cards
- `scripts/recipe/` — single recipe view with unit conversion and substitution UI

SCSS is organized in `src/styles/` with partials under `pantry/` and `recipe/` subdirectories. Keep styles scoped and modular to prevent CSS bleed.

### Brand / Design

- **Colors:** Warm Apricot `#E5B299` (accent), Espresso `#4A4036` (headings), Warm Taupe `#8C7F70` (body), Vanilla Cream `#FDFBF7` (background), Almond `#F4EFE6` (surface), Oat Milk `#E8E3D9` (borders)
- **Typography:** Fraunces (headings), Quicksand (body), monospace (data/vectors)
- **Icons:** Feather icons (`feather-icons` package)

## Environment Setup

**Extension** (`apps/extension/.env`):
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

**API** (`apps/api/.env`):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `GEMINI_API_KEY`
- `EXTENSION_ID` (Chrome extension ID for CORS)
- `MAX_PAYLOAD_CHARS` (default 20000), `EXTRACT_WEEKLY_LIMIT`, `SUBSTITUTE_WEEKLY_LIMIT`
