const CATEGORY = /^[a-z-]+(?:\.[A-Z-]+)?$/i;

export function text(value, max, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, max);
}

export function integer(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function searchInput(body = {}) {
  const query = text(body.query, 500);
  const rawCategory = text(body.category, 40);
  const category = CATEGORY.test(rawCategory) ? rawCategory : "";
  if (rawCategory && !category) throw new Error("Invalid arXiv category.");
  return {
    query,
    category,
    maxResults: integer(body.maxResults, 1, 50, 20),
    sortBy: body.sortBy === "submittedDate" ? "submittedDate" : "relevance",
    profile: sanitizeProfile(body.profile),
  };
}

export function sanitizeProfile(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.folders)) return null;
  return {
    folders: value.folders.slice(0, 50).map((folder) => ({
      name: text(folder?.name, 120, "Untitled"),
      categories: strings(folder?.categories, 20, 40),
      terms: strings(folder?.terms, 30, 80),
    })),
  };
}

function strings(value, limit, maxLength) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((item) => text(item, maxLength)).filter(Boolean);
}

function safeUrl(value) {
  const candidate = text(value, 2_000);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

export function sanitizeFolder(value) {
  if (!value || typeof value !== "object") return null;
  return {
    name: text(value.name, 120, "Untitled"),
    papers: (Array.isArray(value.papers) ? value.papers : []).slice(0, 40).map((paper) => ({
      title: text(paper?.title, 500, "Untitled paper"),
      arxivId: text(paper?.arxivId, 80),
      authors: strings(paper?.authors, 30, 160),
      abstract: text(paper?.abstract, 8_000),
      categories: strings(paper?.categories, 20, 40),
    })),
    excerpts: (Array.isArray(value.excerpts) ? value.excerpts : []).slice(0, 60).map((excerpt) => ({
      text: text(excerpt?.text, 4_000),
      note: text(excerpt?.note, 2_000),
      source: safeUrl(excerpt?.source) || text(excerpt?.source, 500),
    })).filter((excerpt) => excerpt.text),
  };
}

export function chatInput(body = {}) {
  const candidates = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-50)
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .map((message) => ({ role: message.role, content: text(message.content, 8_000) }))
    .filter((message) => message.content);
  const messages = [];
  let remaining = 48_000;
  for (const message of candidates.reverse()) {
    if (remaining <= 0) break;
    const content = message.content.slice(-remaining);
    messages.unshift({ ...message, content });
    remaining -= content.length;
  }
  const bookmarks = (Array.isArray(body.bookmarks) ? body.bookmarks : []).slice(0, 50).map((bookmark) => ({
    kind: ["paper", "idea", "tab"].includes(bookmark?.kind) ? bookmark.kind : "idea",
    title: text(bookmark?.title, 500),
    text: text(bookmark?.text, 4_000),
    url: safeUrl(bookmark?.url),
    arxivId: text(bookmark?.arxivId, 80),
    abstract: text(bookmark?.abstract, 8_000),
  }));
  return {
    threadName: text(body.threadName, 120, "Untitled"),
    bookmarks,
    folder: sanitizeFolder(body.folder),
    messages,
  };
}

export function categoriesInput(value) {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new Error("categories must be an array.");
  const categories = value.slice(0, 20).map((item) => text(item, 40));
  if (categories.some((category) => !CATEGORY.test(category))) {
    throw new Error("One or more arXiv categories are invalid.");
  }
  return [...new Set(categories)];
}
