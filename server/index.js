import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";

import { searchArxiv } from "./arxiv.js";
import { extractPdfText, deriveQuery, MAX_UPLOAD_BYTES } from "./parse.js";
import { rankBySimilarity, embeddingsEnabled } from "./rank.js";
import { personalize, profileTerms } from "./personalize.js";
import { chat, MOCK_MODE, MODEL } from "./ai.js";
import { runRefresh, readSnapshot } from "./refresh.js";
import { categoriesInput, chatInput, sanitizeFolder, sanitizeProfile, searchInput } from "./validate.js";
import { rateLimit, refreshAuthorized, securityHeaders } from "./security.js";

dotenv.config();

const PORT = process.env.PORT || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, "../client/dist");

const app = express();
const publicError = (err, fallback) =>
  process.env.NODE_ENV === "production" ? fallback : err?.message || fallback;
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use(securityHeaders);
if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()) }));
}
app.use(express.json({ limit: "1mb", strict: true }));
app.use("/api", rateLimit({ max: 120 }));
app.use(express.static(CLIENT_DIST));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mockMode: MOCK_MODE,
    model: MODEL,
    embeddingsEnabled,
    ranking: embeddingsEnabled ? "embeddings" : "lexical",
    interactiveRefresh:
      process.env.NODE_ENV !== "production" && !process.env.REFRESH_TOKEN,
  });
});

// ---------------------------------------------------------------------------
// DISCOVER: keyword / category search, personalized + re-ranked.
// Body: { query, category, maxResults, sortBy, profile }
// ---------------------------------------------------------------------------
app.post("/api/search", async (req, res) => {
  let input;
  try {
    input = searchInput(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const { query, category, maxResults, sortBy, profile } = input;

  if (!query.trim() && !category.trim()) {
    return res
      .status(400)
      .json({ error: "Provide a search query or an arXiv category." });
  }

  try {
    const { papers, cached } = await searchArxiv({
      query,
      category,
      maxResults,
      sortBy,
    });

    // Score against the query (and profile terms for a bare category browse).
    const rankQuery =
      query.trim() || profileTerms(profile).join(" ") || category;
    const { papers: ranked, method } = await rankBySimilarity(rankQuery, papers);
    const personalized = personalize(ranked, profile);

    res.json({
      papers: personalized,
      cached,
      rankingMethod: method,
      count: personalized.length,
    });
  } catch (err) {
    console.error("search error:", err.message);
    res.status(502).json({ error: publicError(err, "arXiv search is temporarily unavailable.") });
  }
});

// ---------------------------------------------------------------------------
// DISCOVER: upload a PDF -> extract text -> derive a query -> similar papers.
// Multipart field "file"; optional JSON field "profile".
// ---------------------------------------------------------------------------
app.post("/api/similar-from-pdf", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No PDF uploaded." });
  if (!req.file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    return res.status(415).json({ error: "The uploaded file is not a valid PDF." });
  }

  let profile = null;
  if (req.body && req.body.profile) {
    try {
      profile = sanitizeProfile(JSON.parse(req.body.profile));
    } catch {
      profile = null;
    }
  }

  try {
    const text = await extractPdfText(req.file.buffer);
    if (!text || text.trim().length < 40) {
      return res.status(422).json({
        error:
          "Could not extract usable text from that PDF (it may be a scanned image). Try a text-based PDF or search by keyword instead.",
      });
    }

    const derived = deriveQuery(text);
    const { papers } = await searchArxiv({
      query: derived.query,
      maxResults: 25,
      sortBy: "relevance",
    });

    const { papers: ranked, method } = await rankBySimilarity(
      `${derived.guessedTitle} ${derived.abstractPreview}`,
      papers
    );
    const personalized = personalize(ranked, profile);

    res.json({
      derived,
      papers: personalized,
      rankingMethod: method,
      filename: req.file.originalname,
    });
  } catch (err) {
    console.error("pdf similar error:", err.message);
    res.status(400).json({ error: publicError(err, "Failed to process the PDF.") });
  }
});

// ---------------------------------------------------------------------------
// CHAT: grounded research-assistant reply for one chat window.
// Body: { threadName, bookmarks, folder, messages }
// ---------------------------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  const { threadName, bookmarks, folder, messages } = chatInput(req.body);
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "No messages provided." });
  }
  try {
    const { mockMode, reply } = await chat(
      { threadName, bookmarks, folder },
      messages
    );
    res.json({ mockMode, reply });
  } catch (err) {
    console.error("chat error:", err.message);
    res.status(500).json({ error: publicError(err, "Chat failed.") });
  }
});

// Collection-level literature synthesis, sharing the same grounded AI path as
// chat so saved papers and imported reading excerpts stay the source of truth.
app.post("/api/analyze-folder", async (req, res) => {
  const folder = sanitizeFolder(req.body?.folder);
  if (!folder || !Array.isArray(folder.papers) || folder.papers.length === 0) {
    return res.status(400).json({ error: "Choose a folder with at least one paper." });
  }
  try {
    const result = await chat(
      { threadName: `Collection analysis: ${folder.name || "Untitled"}`, bookmarks: [], folder },
      [{
        role: "user",
        content: "Synthesize this collection. Identify common themes, compare methods, surface disagreements or gaps, and propose the three strongest next research questions. Stay grounded in the saved papers and excerpts.",
      }]
    );
    res.json({ mockMode: result.mockMode, reply: result.reply });
  } catch (err) {
    console.error("folder analysis error:", err.message);
    res.status(500).json({ error: publicError(err, "Collection analysis failed.") });
  }
});

// ---------------------------------------------------------------------------
// REFRESH: routine corpus refresh (also runnable via `npm run refresh`).
// ---------------------------------------------------------------------------
app.post("/api/refresh", rateLimit({ windowMs: 60_000, max: 5 }), async (req, res) => {
  if (!refreshAuthorized(req)) {
    return res.status(403).json({ error: "Corpus refresh is not authorized." });
  }
  let categories;
  try {
    categories = categoriesInput(req.body?.categories);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    const result = await runRefresh(categories);
    res.json(result);
  } catch (err) {
    console.error("refresh error:", err.message);
    res.status(500).json({ error: publicError(err, "Refresh failed.") });
  }
});

app.get("/api/refresh", async (_req, res) => {
  const snapshot = await readSnapshot();
  if (!snapshot) {
    return res.json({ refreshedAt: null, message: "No refresh has run yet." });
  }
  // Return metadata only (not the full corpus) for a light status check.
  const { refreshedAt, categories, counts, total } = snapshot;
  res.json({ refreshedAt, categories, counts, total });
});

// Multer errors (e.g. file too large).
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload failed: ${err.message}` });
  }
  if (err instanceof SyntaxError && err.status === 400) {
    return res.status(400).json({ error: "Malformed JSON request." });
  }
  next(err);
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});

// SPA catch-all.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(CLIENT_DIST, "index.html"), (err) => {
    if (err) next();
  });
});

app.use((err, _req, res, _next) => {
  console.error("unhandled request error:", err);
  res.status(500).json({ error: "Unexpected server error." });
});

export function startServer(port = PORT) {
  const server = app.listen(port, () => {
    const aiMode = MOCK_MODE ? "MOCK MODE — no API key" : `LIVE — ${MODEL}`;
    const rank = embeddingsEnabled ? "embeddings" : "lexical (BM25)";
    const address = server.address();
    const activePort = typeof address === "object" && address ? address.port : port;
    console.log(
      `rxiver server on http://localhost:${activePort}  [AI: ${aiMode}]  [ranking: ${rank}]`
    );
  });
  return server;
}

export { app };

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  startServer();
}
