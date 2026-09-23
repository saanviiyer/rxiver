# rxiver

rxiver is an AI research workspace. It recommends arXiv papers, organizes your research into folders, exports citations, and holds research chats grounded in your saved papers. It combines the earlier rxiver, Paperclip, and Gloss concepts in one app.

Recommendations lean toward what you have saved. The arXiv corpus refreshes on a schedule you control. This is a corpus snapshot plus personalization. No model training happens.

## Features

- Discover. Search arXiv through its public API (the server parses the Atom XML). You can also upload a PDF to find similar papers. The app re-ranks results for relevance, boosts them toward your saved folders, and shows a short "why recommended" reason.
- Organize. Save papers to folders, or paste excerpts with a note and a source link. Copy APA citations or download a folder as BibTeX.
- Analyze collections. Get a synthesis of the papers and excerpts in a folder, grounded in their titles, authors, categories, and abstracts.
- Capture while reading. Import the JSON from the "Export to rxiver" action of the separate gloss browser extension. Highlights become excerpts, explanations become notes, and source pages stay attached.
- Chat windows. Named threads bookmark papers, ideas, and tabs, and hold a research-assistant chat grounded in those bookmarks and an optional linked folder.
- Portable workspaces. Download a versioned JSON backup of all folders, papers, excerpts, bookmarks, and chats. Restore it in another browser. Restore validates and normalizes the whole file before it replaces local data.

## How it works

Ranking:

- Lexical (default, no dependencies). BM25 scores each candidate's title and abstract against the query (`server/rank.js`). For "find similar from PDF", `server/parse.js` builds the query from the PDF's abstract region and key terms.
- Semantic (optional). If an embeddings endpoint is configured, candidates are ranked by cosine similarity of embeddings. On any error, ranking falls back to BM25.
- Personalization. `server/personalize.js` boosts results that overlap with the categories and terms of your saved folders and writes the reason text.

arXiv use: paper metadata comes from the public arXiv API (`export.arxiv.org`). Thank you to arXiv for use of its open access interoperability. The client caches identical queries for 5 minutes and spaces upstream requests to about one every 3 seconds (`server/arxiv.js`), in line with arXiv's usage guidelines. rxiver is not affiliated with or endorsed by arXiv.

Persistence is local-first. The UI talks only to the `Repository` interface in `client/src/lib/repository.ts`, which uses `localStorage` today. A Supabase adapter (Postgres tables with a `user_id` column and `auth.uid() = user_id` row-level security) could replace it with no UI changes. Until then, data stays in one browser profile and there are no accounts. Use Back up often. Public multi-device accounts need hosted auth, Postgres with RLS, storage, and the async adapter.

## Run it

```bash
git clone https://github.com/saanviiyer/rxiver
cd rxiver
npm install        # installs root and client dependencies
npm run dev        # Express API on :3001 and Vite client on :5173
```

Open http://localhost:5173. The client proxies `/api` to the server. With no keys, arXiv search and PDF similarity work, chat runs in mock mode with canned replies, and ranking uses BM25.

```bash
npm test           # server tests (node --test) and client tests (vitest)
npm run build      # build the client to client/dist
npm start          # production: Express serves client/dist and /api on $PORT
```

### Corpus refresh

The refresh fetches the latest papers for your categories and caches them in `server/.cache/refresh.json`.

```bash
npm run refresh

# over HTTP
curl -X POST http://localhost:3001/api/refresh \
  -H 'content-type: application/json' \
  -d '{"categories":["cs.LG","q-bio.NC"]}'
curl http://localhost:3001/api/refresh      # status only
```

To run it daily, use cron (`0 7 * * * cd /path/to/rxiver && npm run refresh`), a macOS launchd agent with `StartCalendarInterval` at hour 7, or a Render Cron Job. A scheduler can also call `POST /api/refresh` with `Authorization: Bearer $REFRESH_TOKEN`. In production, the server refuses HTTP refresh unless `REFRESH_TOKEN` is set. The browser refresh button shows only in local development.

### Deploy

- Docker: `docker build -t rxiver . && docker run -p 3001:3001 rxiver`. The multi-stage build runs in mock mode with no `ANTHROPIC_API_KEY`.
- Render: `render.yaml` defines a Node web service (build `npm install && npm run build`, start `npm start`) with `ANTHROPIC_API_KEY` as a secret and the optional embeddings and refresh variables.

Production hardening:

- The API is same-origin by default. Cross-origin access needs an explicit `CORS_ORIGIN` allowlist.
- Every response gets CSP, clickjacking, MIME-sniffing, referrer, and permissions headers. Express fingerprinting is off.
- An in-memory rate limiter covers API traffic. Refresh has a stricter limit and bearer-token protection. Request bodies and AI context have size limits.
- PDF uploads are capped at 12 MB and must have a real PDF signature. Calls to arXiv, embeddings, and the AI have timeouts.
- For more than one server instance, replace the in-memory rate limiter with a shared Redis limiter. Set `TRUST_PROXY=1` only behind one trusted reverse proxy.

## Environment variables

All are optional. With none set, the app runs in mock AI mode with BM25 ranking. Copy `.env.example` to `.env`. The server reads them. None go to the browser.

| Name | Purpose |
| ---- | ------- |
| `ANTHROPIC_API_KEY` | Turns on live chat and analysis. Mock mode if unset. |
| `ANTHROPIC_MODEL` | Model override (default `claude-sonnet-5`) |
| `EMBEDDINGS_PROVIDER` | URL of an OpenAI-compatible embeddings endpoint. Semantic ranking needs this and the key. |
| `EMBEDDINGS_API_KEY` | Key for the embeddings endpoint |
| `EMBEDDINGS_MODEL` | Model name sent to the embeddings endpoint |
| `REFRESH_CATEGORIES` | arXiv categories for refresh (default `cs.LG,cs.AI,cs.CL`) |
| `REFRESH_TOKEN` | Bearer token for HTTP refresh. Required for HTTP refresh in production. |
| `CORS_ORIGIN` | Comma-separated allowed origins for a separate frontend |
| `TRUST_PROXY` | Set to `1` behind one trusted reverse proxy |
| `UPSTREAM_TIMEOUT_MS` | Timeout for arXiv, embeddings, and AI calls |
| `PORT` | Server port (default 3001) |

The embeddings endpoint must accept `POST { input: [...] }` and return `{ data: [{ embedding: [...] }] }`.

## Layout

```
server/              Express (ESM) API
  index.js           routes: /api/search, /api/similar-from-pdf, /api/chat,
                     /api/analyze-folder, /api/refresh, /api/health
  arxiv.js           arXiv fetch, parse, cache, and rate limit
  parse.js           PDF text extraction (unpdf) and query building
  rank.js            BM25 ranker and optional embeddings
  personalize.js     folder-based boosting and reasons
  ai.js              Anthropic chat and mock mode
  refresh.js         corpus refresh script
  security.js, validate.js, *.test.js
client/              Vite, React, TypeScript (strict), Tailwind
  src/lib/repository.ts   local-first data access
  src/lib/api.ts          typed fetch wrappers for /api
  src/lib/cite.ts         APA and BibTeX formatting
  src/components/         Discover, Organize, Chat, PaperCard
Dockerfile, render.yaml, .env.example
```
