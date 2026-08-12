// Thin fetch wrappers around the server API. All calls go through /api, which
// Vite proxies to the Express server in dev and the same origin in production.

import type { Bookmark, ChatMessage, Folder, Paper, Profile } from "../types";

async function jsonPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export interface Health {
  ok: boolean;
  mockMode: boolean;
  model: string;
  embeddingsEnabled: boolean;
  ranking: string;
}

export function getHealth(): Promise<Health> {
  return fetch("/api/health").then((r) => r.json());
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
  const res = await fetch("/api/similar-from-pdf", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || "Upload failed");
  return data as PdfSimilarResult;
}

export interface ChatResult {
  mockMode: boolean;
  reply: string;
}

// Compact folder shape passed to the chat endpoint as grounding context.
export interface ChatFolderContext {
  name: string;
  papers: { title: string; arxivId: string }[];
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
  return fetch("/api/refresh").then((r) => r.json());
}

// Helper to convert a Folder to the compact chat grounding shape.
export function folderToContext(folder: Folder | undefined): ChatFolderContext | null {
  if (!folder) return null;
  return {
    name: folder.name,
    papers: folder.papers.map((p) => ({ title: p.title, arxivId: p.arxivId })),
    excerpts: folder.excerpts.map((e) => ({
      text: e.text,
      note: e.note,
      source: e.source,
    })),
  };
}
