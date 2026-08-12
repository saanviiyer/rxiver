# rxiver — an AI research workspace

rxiver is a research buddy that (a) **recommends arXiv papers** by topic/keyword
or from an uploaded PDF, and (b) lets you **organize** findings into folders of
papers and excerpts and **think about them** in named chat windows that bookmark
papers, ideas, and tabs.

Recommendations are **biased toward what you've saved**, and the arXiv corpus is
refreshed on a routine you control. That is the honest version of "retrains on
arXiv": a **continuously-updated corpus snapshot + personalization**, **not**
literal model training.

- **Discover** — real arXiv search (public API, Atom XML parsed server-side), plus
  "upload a PDF → find similar papers". Results are re-ranked for relevance and
  biased toward your saved folders, with a short "why recommended" reason.
- **Organize** — folders/collections. Save whole papers or paste **excerpts** with
  a note and a source link/citation.
- **Chat windows** — named threads that bookmark papers/ideas/tabs and hold an AI
  research-assistant conversation grounded in those bookmarks + an optional linked
  folder.

## Run it (zero setup)

```bash
npm install       # installs root + client deps
npm run dev        # runs the Express API and the Vite client together
```

Open http://localhost:5173. The client proxies `/api` to the server on `:3001`.

With **no keys at all** the app is fully usable:

- Real arXiv keyword/category search and PDF-similarity work with no key.
- The AI chat runs in **MOCK MODE** (realistic, grounded-looking canned replies).
- "Similar to this" ranking uses a built-in **BM25 lexical scorer** (zero deps).

## Run it live (optional keys)

Copy `.env.example` to `.env` and set what you want:

- `ANTHROPIC_API_KEY` — enables live chat replies via `claude-sonnet-5`. Leave
  unset for mock mode.
- `EMBEDDINGS_PROVIDER` + `EMBEDDINGS_API_KEY` (+ optional `EMBEDDINGS_MODEL`) —
  if **both** are set, "find similar" ranks candidates with **semantic
  embeddings** (cosine similarity) from a generic OpenAI-compatible HTTP
  embeddings endpoint (`POST { input: [...] } → { data: [{ embedding: [...] }] }`).
  If either is missing, ranking falls back to the lexical BM25 scorer. **The app
  works fully with no embeddings key.**

## Ranking approach

- **Lexical (default, zero-dependency):** BM25 over each candidate's title +
  abstract against the query (`server/rank.js`). For "find similar from PDF" the
  query is derived from the PDF's abstract region and key terms
  (`server/parse.js`).
- **Semantic (optional):** if an embeddings endpoint is configured, candidates
  are ranked by cosine similarity of embeddings instead, with automatic fallback
  to BM25 on any error.
- **Personalization:** results are boosted by overlap with the categories and
  terms of your saved folders, and each result shows a "why recommended" reason
  (e.g. *matches your "continual learning" folder*). See `server/personalize.js`.

## arXiv attribution & politeness

Paper metadata comes from the public **arXiv API** (`export.arxiv.org`). Thank
you to arXiv for use of its open-access interoperability. rxiver is a polite
client: it caches identical queries briefly (5 min) and spaces upstream requests
to roughly one every 3 seconds (`server/arxiv.js`), in line with arXiv's usage
guidelines. rxiver is not affiliated with or endorsed by arXiv.

## Routine corpus refresh ("retrains on arXiv", honestly)

rxiver keeps its corpus fresh by re-fetching the latest papers for your followed
categories and caching them — **no model training happens**. Configure the
categories with `REFRESH_CATEGORIES` (default `cs.LG,cs.AI,cs.CL`).

Run it three ways:

```bash
# 1. Manually
npm run refresh

# 2. Over HTTP
curl -X POST http://localhost:3001/api/refresh \
  -H 'content-type: application/json' \
  -d '{"categories":["cs.LG","q-bio.NC"]}'

# Check status (metadata only)
curl http://localhost:3001/api/refresh
```

The snapshot is written to `server/.cache/refresh.json`.

**Run it daily on a schedule:**

- **cron (Linux/macOS):** `crontab -e`, then

  ```cron
  # 07:00 every day, from the project directory
  0 7 * * * cd /path/to/rxiver && /usr/bin/npm run refresh >> /tmp/rxiver-refresh.log 2>&1
  ```

- **macOS launchd:** create a `~/Library/LaunchAgents/com.rxiver.refresh.plist`
  that runs `npm run refresh` in the project directory on a `StartCalendarInterval`
  of hour 7, then `launchctl load` it.

- **Render (deployed):** add a **Cron Job** service pointing at this repo with the
  command `npm run refresh` and a daily schedule (`0 7 * * *`), or curl the
  `POST /api/refresh` endpoint of the web service from any scheduler.

## Deploy

Production serves the built client and the API on a single `$PORT`:

```bash
npm run build      # builds the client (client/dist); must pass with zero TS errors
npm start          # NODE_ENV=production, Express serves client/dist + /api on $PORT
```

- **Docker:** multi-stage `Dockerfile` builds the client and runs the API-only
  runtime image. `docker build -t rxiver . && docker run -p 3001:3001 rxiver`.
  With no `ANTHROPIC_API_KEY` the container runs in mock mode.
- **Render:** `render.yaml` defines a Node web service (`npm install && npm run
  build`, start `npm start`) with `ANTHROPIC_API_KEY` as a `sync: false` secret
  and the optional embeddings/refresh vars.

## Persistence & the Supabase upgrade path

Persistence is **localStorage-first**, but the entire UI talks to a single
**repository interface** (`client/src/lib/repository.ts`) — it never touches
`localStorage` directly. Folders, saved papers, excerpts, chat threads,
bookmarks, and messages all flow through that interface.

To move to a real backend later, implement the same `Repository` interface
against **Supabase** (auth + Postgres + Row-Level Security) and swap the exported
instance — **no UI changes required**:

- One Postgres table per entity (`folders`, `saved_papers`, `excerpts`,
  `threads`, `bookmarks`, `messages`), each with a `user_id` column.
- RLS policies keyed on `auth.uid() = user_id` so each user only sees their rows.
- A thin async adapter class implementing `Repository` (the methods would become
  `async`; the UI already awaits nothing synchronous that couldn't be adapted).

This mirrors the pattern used by the sibling apps in this repo family.

## Project layout

```
rxiver/
  server/            Express (ESM) API
    index.js         routes: /api/search, /api/similar-from-pdf, /api/chat, /api/refresh, /api/health
    arxiv.js         arXiv Atom fetch + parse + polite cache/rate-limit
    parse.js         PDF text extraction (unpdf) + query derivation
    rank.js          BM25 lexical ranker + optional semantic embeddings
    personalize.js   folder-based boosting + "why recommended" reasons
    ai.js            Anthropic chat (claude-sonnet-5) + mock mode
    refresh.js       routine corpus refresh (script + endpoint)
  client/            Vite + React + TypeScript (strict) + Tailwind
    src/lib/repository.ts   localStorage-first data-access abstraction
    src/lib/api.ts          typed fetch wrappers for /api
    src/components/         Discover, Organize, Chat, PaperCard
  Dockerfile, .dockerignore, render.yaml, .env.example
```
