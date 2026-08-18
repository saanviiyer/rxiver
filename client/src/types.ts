// Core domain types, shared across the UI and the data-access layer.

export interface Paper {
  id: string; // arXiv id, e.g. "2401.01234"
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  published: string;
  updated?: string;
  absUrl: string;
  pdfUrl: string;
  // Present on ranked/personalized results:
  score?: number;
  finalScore?: number;
  personalBoost?: number;
  reason?: string;
}

// A paper saved into a folder (denormalized snapshot so it survives even if the
// arXiv result later changes).
export interface SavedPaper {
  savedId: string;
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  absUrl: string;
  pdfUrl: string;
  published?: string;
  savedAt: string;
}

export interface GlossExcerptExport {
  version: 1;
  source: "rxiver-gloss";
  exportedAt: string;
  excerpts: { text: string; note: string; source: string }[];
}

export interface WorkspaceExport {
  version: 1;
  source: "rxiver-workspace";
  exportedAt: string;
  folders: Folder[];
  threads: ChatThread[];
}

export interface Excerpt {
  id: string;
  text: string;
  note: string;
  source: string; // link or citation
  createdAt: string;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
  papers: SavedPaper[];
  excerpts: Excerpt[];
}

export type BookmarkKind = "paper" | "idea" | "tab";

export interface Bookmark {
  id: string;
  kind: BookmarkKind;
  title?: string; // paper title / tab title
  url?: string; // tab url
  text?: string; // idea text
  arxivId?: string;
  abstract?: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  mockMode?: boolean;
}

export interface ChatThread {
  id: string;
  name: string;
  createdAt: string;
  linkedFolderId: string | null;
  bookmarks: Bookmark[];
  messages: ChatMessage[];
}

// The compact personalization profile the client sends to the server.
export interface Profile {
  folders: { name: string; categories: string[]; terms: string[] }[];
}
