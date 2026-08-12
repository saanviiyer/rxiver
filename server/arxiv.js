// arXiv API client. Queries the public export API (Atom XML, no key needed),
// parses the feed with a small dependency-free parser, and applies a short
// in-memory cache plus a polite minimum interval between upstream requests so
// we stay well within arXiv's usage guidelines.
//
// Docs: https://info.arxiv.org/help/api/user-manual.html

const ARXIV_ENDPOINT = "http://export.arxiv.org/api/query";

// Be polite: cache identical queries briefly and never hit arXiv more than
// once every MIN_INTERVAL_MS. arXiv asks callers to keep to ~1 request / 3s.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MIN_INTERVAL_MS = 3000;

const cache = new Map(); // key -> { at, data }
let lastRequestAt = 0;
let queue = Promise.resolve();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Serialize upstream calls through a queue and space them out politely.
function rateLimited(fn) {
  const run = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  // Keep the queue chain alive even if this call rejects.
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// ---- Minimal Atom/XML helpers (dependency-free) ---------------------------

function decodeEntities(s = "") {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function clean(s = "") {
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}

function allTags(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function firstTag(xml, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? m[1] : "";
}

function attr(fragment, name) {
  const m = new RegExp(`${name}="([^"]*)"`).exec(fragment);
  return m ? decodeEntities(m[1]) : "";
}

// Extract the bare arXiv id (e.g. "2401.01234") from the entry <id> URL.
function bareId(idUrl = "") {
  const m = /arxiv\.org\/abs\/([^\s<]+?)(v\d+)?$/.exec(idUrl.trim());
  if (m) return m[1];
  const tail = idUrl.trim().split("/").pop() || idUrl.trim();
  return tail.replace(/v\d+$/, "");
}

function parseEntry(entryXml) {
  const idUrl = clean(firstTag(entryXml, "id"));
  const id = bareId(idUrl);

  const authors = allTags(entryXml, "author")
    .map((a) => clean(firstTag(a, "name")))
    .filter(Boolean);

  // <category term="cs.LG" .../> — self-closing, so match the raw tags.
  const categories = [];
  const catRe = /<category\b[^>]*\/?>/g;
  let cm;
  while ((cm = catRe.exec(entryXml)) !== null) {
    const term = attr(cm[0], "term");
    if (term) categories.push(term);
  }

  // Links: prefer rel="alternate" for the abs page and title="pdf" for the pdf.
  let absUrl = idUrl;
  let pdfUrl = "";
  const linkRe = /<link\b[^>]*\/?>/g;
  let lm;
  while ((lm = linkRe.exec(entryXml)) !== null) {
    const href = attr(lm[0], "href");
    const title = attr(lm[0], "title");
    const type = attr(lm[0], "type");
    const rel = attr(lm[0], "rel");
    if (title === "pdf" || type === "application/pdf") pdfUrl = href;
    else if (rel === "alternate" || type === "text/html") absUrl = href || absUrl;
  }
  if (!pdfUrl && id) pdfUrl = `https://arxiv.org/pdf/${id}`;

  return {
    id,
    title: clean(firstTag(entryXml, "title")),
    authors,
    abstract: clean(firstTag(entryXml, "summary")),
    categories,
    published: clean(firstTag(entryXml, "published")),
    updated: clean(firstTag(entryXml, "updated")),
    absUrl,
    pdfUrl,
  };
}

export function parseFeed(xml) {
  return allTags(xml, "entry")
    .map(parseEntry)
    .filter((p) => p.id && p.title);
}

// ---- Query building + fetch -----------------------------------------------

// Noise tokens that carry no topical signal (citation cruft, filler).
const QUERY_NOISE = new Set(
  "et al the a an and or of to in for with on at as is are be by we our this that from into using".split(
    " "
  )
);

// Turn a free-text query into arXiv term clauses. Uses AND for short, precise
// queries and OR for long (PDF-derived) ones so "find similar" keeps recall.
function termClauses(query) {
  const terms = (query.toLowerCase().match(/[a-z][a-z0-9+.#-]{2,}/g) || [])
    .map((t) => t.replace(/[.]+$/, ""))
    .filter((t) => t.length > 2 && !QUERY_NOISE.has(t));
  // De-dupe, keep order, cap to keep the URL sane.
  const seen = new Set();
  const unique = [];
  for (const t of terms) {
    if (!seen.has(t)) {
      seen.add(t);
      unique.push(t);
    }
  }
  const top = unique.slice(0, 8);
  if (top.length === 0) return "";
  const joiner = top.length > 4 ? " OR " : " AND ";
  return `(${top.map((t) => `all:${t}`).join(joiner)})`;
}

function buildSearchQuery({ query, category }) {
  const parts = [];
  if (query && query.trim()) {
    const clause = termClauses(query);
    if (clause) parts.push(clause);
  }
  if (category && category.trim()) {
    parts.push(`cat:${category.trim()}`);
  }
  if (parts.length === 0) parts.push("all:machine learning");
  return parts.join(" AND ");
}

async function fetchArxiv(params) {
  const url = `${ARXIV_ENDPOINT}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "rxiver/1.0 (research workspace; polite client)" },
  });
  if (!res.ok) {
    throw new Error(`arXiv responded ${res.status}`);
  }
  return res.text();
}

/**
 * Search arXiv by free-text query and/or category.
 * @returns {Promise<{papers: object[], cached: boolean, total: number}>}
 */
export async function searchArxiv({
  query = "",
  category = "",
  start = 0,
  maxResults = 20,
  sortBy = "relevance",
} = {}) {
  const searchQuery = buildSearchQuery({ query, category });
  const params = new URLSearchParams({
    search_query: searchQuery,
    start: String(start),
    max_results: String(Math.min(Math.max(maxResults, 1), 50)),
    sortBy: sortBy === "submittedDate" ? "submittedDate" : "relevance",
    sortOrder: "descending",
  });

  const key = params.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { papers: hit.data, cached: true, total: hit.data.length };
  }

  const xml = await rateLimited(() => fetchArxiv(params));
  const papers = parseFeed(xml);
  cache.set(key, { at: Date.now(), data: papers });
  return { papers, cached: false, total: papers.length };
}

/** Fetch the latest papers in a category (used by the routine refresh). */
export async function latestInCategory(category, maxResults = 25) {
  return searchArxiv({
    category,
    maxResults,
    sortBy: "submittedDate",
  });
}
