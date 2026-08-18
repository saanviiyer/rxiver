// Thin fetch wrappers around the server API. All calls go through /api, which
// Vite proxies to the Express server in dev and the same origin in production.

import type { Bookmark, ChatMessage, Folder, Paper, Profile } from "../types";

async function jsonRequest<T>(url: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error("The request timed out. Please try again.");
    throw new Error("Could not reach the rxiver server. Check your connection and try again.");
  } finally {
    window.clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

async function jsonPost<T>(url: string, body: unknown): Promise<T> {
  return jsonRequest<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface Health {
  ok: boolean;
  mockMode: boolean;
  model: string;
  embeddingsEnabled: boolean;
  ranking: string;
  interactiveRefresh: boolean;
}

export function getHealth(): Promise<Health> {
  return jsonRequest<Health>("/api/health", undefined, 10_000);
}

export interface SearchResult {
  papers: Paper[];
  cached: boolean;
  rankingMethod: "embeddings" | "lexical";
  count: number;
}

export function search(params: {
  query?: string;
  category?: string;
  maxResults?: number;
  sortBy?: "relevance" | "submittedDate";
  profile?: Profile | null;
}): Promise<SearchResult> {
  return jsonPost<SearchResult>("/api/search", params);
}

export interface PdfSimilarResult {
  derived: {
    query: string;
    keyTerms: string[];
    guessedTitle: string;
    abstractPreview: string;
  };
  papers: Paper[];
  rankingMethod: "embeddings" | "lexical";
  filename: string;
}

export async function similarFromPdf(
  file: File,
  profile: Profile | null
): Promise<PdfSimilarResult> {
  const form = new FormData();
  form.append("file", file);
  if (profile) form.append("profile", JSON.stringify(profile));
  return jsonRequest<PdfSimilarResult>(
    "/api/similar-from-pdf",
    { method: "POST", body: form },
    60_000
  );
}

export interface ChatResult {
  mockMode: boolean;
  reply: string;
}

// Compact folder shape passed to the chat endpoint as grounding context.
export interface ChatFolderContext {
  name: string;
  papers: {
    title: string;
    arxivId: string;
    authors: string[];
    abstract: string;
    categories: string[];
  }[];
  excerpts: { text: string; note: string; source: string }[];
}

export function chat(params: {
  threadName: string;
  bookmarks: Bookmark[];
  folder: ChatFolderContext | null;
  messages: Pick<ChatMessage, "role" | "content">[];
}): Promise<ChatResult> {
  return jsonPost<ChatResult>("/api/chat", params);
}

export function analyzeFolder(folder: Folder): Promise<ChatResult> {
  return jsonPost<ChatResult>("/api/analyze-folder", {
    folder: folderToContext(folder),
  });
}

export interface RefreshResult {
  refreshedAt: string | null;
  categories?: string[];
  counts?: Record<string, number>;
  total?: number;
  message?: string;
}

export function runRefresh(categories?: string[]): Promise<RefreshResult> {
  return jsonPost<RefreshResult>("/api/refresh", categories ? { categories } : {});
}

export function getRefreshStatus(): Promise<RefreshResult> {
  return jsonRequest<RefreshResult>("/api/refresh", undefined, 10_000);
}

// Helper to convert a Folder to the compact chat grounding shape.
export function folderToContext(folder: Folder | undefined): ChatFolderContext | null {
  if (!folder) return null;
  return {
    name: folder.name,
    papers: folder.papers.map((p) => ({
      title: p.title,
      arxivId: p.arxivId,
      authors: p.authors,
      abstract: p.abstract,
      categories: p.categories,
    })),
    excerpts: folder.excerpts.map((e) => ({
      text: e.text,
      note: e.note,
      source: e.source,
    })),
  };
}
