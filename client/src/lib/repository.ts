// Data-access abstraction. The entire UI talks to `repo` (a Repository) and
// never touches localStorage directly. To move persistence to Supabase later,
// implement this same interface against Postgres/RLS and swap the export —
// no UI changes required. See README "Supabase upgrade path".

import type {
  Bookmark,
  ChatMessage,
  ChatThread,
  Excerpt,
  Folder,
  Profile,
  SavedPaper,
  WorkspaceExport,
} from "../types";

export interface Repository {
  // Folders / collections
  listFolders(): Folder[];
  createFolder(name: string): Folder;
  renameFolder(id: string, name: string): void;
  deleteFolder(id: string): void;
  getFolder(id: string): Folder | undefined;

  // Saved papers + excerpts inside a folder
  savePaper(folderId: string, paper: Omit<SavedPaper, "savedId" | "savedAt">): void;
  removePaper(folderId: string, savedId: string): void;
  addExcerpt(folderId: string, excerpt: Omit<Excerpt, "id" | "createdAt">): void;
  updateExcerpt(folderId: string, excerptId: string, patch: Partial<Excerpt>): void;
  removeExcerpt(folderId: string, excerptId: string): void;

  // Chat threads ("chat windows")
  listThreads(): ChatThread[];
  createThread(name: string): ChatThread;
  renameThread(id: string, name: string): void;
  deleteThread(id: string): void;
  getThread(id: string): ChatThread | undefined;
  linkFolder(threadId: string, folderId: string | null): void;

  // Bookmarks within a thread
  addBookmark(threadId: string, bookmark: Omit<Bookmark, "id" | "createdAt">): void;
  removeBookmark(threadId: string, bookmarkId: string): void;

  // Messages within a thread
  appendMessage(threadId: string, message: Omit<ChatMessage, "id" | "createdAt">): ChatMessage;

  // Personalization profile derived from saved folders
  buildProfile(): Profile;

  // Portable, versioned backup. Import replaces the local workspace only after
  // the complete payload has been validated and normalized.
  exportWorkspace(): WorkspaceExport;
  importWorkspace(value: unknown): { folders: number; threads: number };
}

const FOLDERS_KEY = "rxiver.folders.v1";
const THREADS_KEY = "rxiver.threads.v1";

function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private-mode failures
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown, max = 8_000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function stringList(value: unknown, limit = 50): string[] {
  return Array.isArray(value)
    ? value.slice(0, limit).map((item) => stringValue(item, 500)).filter(Boolean)
    : [];
}

function webUrl(value: unknown): string {
  const candidate = stringValue(value, 2_000);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function normalizeFolders(value: unknown): Folder[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 250).flatMap((item) => {
    const folder = record(item);
    if (!folder) return [];
    const id = stringValue(folder.id, 120) || uid();
    const papers = (Array.isArray(folder.papers) ? folder.papers : []).slice(0, 2_000).flatMap((raw) => {
      const paper = record(raw);
      if (!paper) return [];
      const arxivId = stringValue(paper.arxivId, 100);
      const title = stringValue(paper.title, 1_000);
      if (!arxivId || !title) return [];
      return [{
        savedId: stringValue(paper.savedId, 120) || uid(),
        arxivId,
        title,
        authors: stringList(paper.authors),
        abstract: stringValue(paper.abstract, 20_000),
        categories: stringList(paper.categories, 30),
        absUrl: webUrl(paper.absUrl) || `https://arxiv.org/abs/${encodeURIComponent(arxivId)}`,
        pdfUrl: webUrl(paper.pdfUrl) || `https://arxiv.org/pdf/${encodeURIComponent(arxivId)}`,
        published: stringValue(paper.published, 40) || undefined,
        savedAt: stringValue(paper.savedAt, 40) || new Date().toISOString(),
      }];
    });
    const excerpts = (Array.isArray(folder.excerpts) ? folder.excerpts : []).slice(0, 5_000).flatMap((raw) => {
      const excerpt = record(raw);
      if (!excerpt) return [];
      const text = stringValue(excerpt.text, 20_000);
      if (!text) return [];
      return [{
        id: stringValue(excerpt.id, 120) || uid(),
        text,
        note: stringValue(excerpt.note, 8_000),
        source: stringValue(excerpt.source, 2_000),
        createdAt: stringValue(excerpt.createdAt, 40) || new Date().toISOString(),
      }];
    });
    return [{
      id,
      name: stringValue(folder.name, 160) || "Untitled folder",
      createdAt: stringValue(folder.createdAt, 40) || new Date().toISOString(),
      papers,
      excerpts,
    }];
  });
}

function normalizeThreads(value: unknown, folderIds: Set<string>): ChatThread[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 250).flatMap((item) => {
    const thread = record(item);
    if (!thread) return [];
    const bookmarks: Bookmark[] = (Array.isArray(thread.bookmarks) ? thread.bookmarks : [])
      .slice(0, 2_000).flatMap((raw) => {
        const bookmark = record(raw);
        if (!bookmark || !["paper", "idea", "tab"].includes(stringValue(bookmark.kind))) return [];
        return [{
          id: stringValue(bookmark.id, 120) || uid(),
          kind: stringValue(bookmark.kind) as Bookmark["kind"],
          title: stringValue(bookmark.title, 1_000) || undefined,
          url: webUrl(bookmark.url) || undefined,
          text: stringValue(bookmark.text, 8_000) || undefined,
          arxivId: stringValue(bookmark.arxivId, 100) || undefined,
          abstract: stringValue(bookmark.abstract, 20_000) || undefined,
          createdAt: stringValue(bookmark.createdAt, 40) || new Date().toISOString(),
        }];
      });
    const messages: ChatMessage[] = (Array.isArray(thread.messages) ? thread.messages : [])
      .slice(-2_000).flatMap((raw) => {
        const message = record(raw);
        if (!message || !["user", "assistant"].includes(stringValue(message.role))) return [];
        const content = stringValue(message.content, 20_000);
        if (!content) return [];
        return [{
          id: stringValue(message.id, 120) || uid(),
          role: stringValue(message.role) as ChatMessage["role"],
          content,
          createdAt: stringValue(message.createdAt, 40) || new Date().toISOString(),
          mockMode: message.mockMode === true || undefined,
        }];
      });
    const linked = stringValue(thread.linkedFolderId, 120);
    return [{
      id: stringValue(thread.id, 120) || uid(),
      name: stringValue(thread.name, 160) || "Untitled thread",
      createdAt: stringValue(thread.createdAt, 40) || new Date().toISOString(),
      linkedFolderId: linked && folderIds.has(linked) ? linked : null,
      bookmarks,
      messages,
    }];
  });
}

export function parseWorkspaceExport(value: unknown): Pick<WorkspaceExport, "folders" | "threads"> {
  const payload = record(value);
  if (!payload || payload.version !== 1 || payload.source !== "rxiver-workspace") {
    throw new Error("This is not a supported rxiver workspace backup.");
  }
  const folders = normalizeFolders(payload.folders);
  const threads = normalizeThreads(payload.threads, new Set(folders.map((folder) => folder.id)));
  return { folders, threads };
}

// Very small stopword-free tokenizer, mirrors the server's, for profile terms.
const STOP = new Set(
  "a an and are as at be by for from has have in into is it its of on or that the their this to was were with we our you your which using also can new".split(
    " "
  )
);
function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9+.#-]{2,}/g) || []).filter(
    (w) => !STOP.has(w)
  );
}

class LocalStorageRepository implements Repository {
  private folders: Folder[] = normalizeFolders(read<unknown>(FOLDERS_KEY, []));
  private threads: ChatThread[] = normalizeThreads(
    read<unknown>(THREADS_KEY, []),
    new Set(this.folders.map((folder) => folder.id))
  );

  private persistFolders() {
    write(FOLDERS_KEY, this.folders);
  }
  private persistThreads() {
    write(THREADS_KEY, this.threads);
  }

  // ---- Folders ----
  listFolders() {
    return [...this.folders];
  }
  getFolder(id: string) {
    return this.folders.find((f) => f.id === id);
  }
  createFolder(name: string) {
    const folder: Folder = {
      id: uid(),
      name: name.trim() || "Untitled folder",
      createdAt: new Date().toISOString(),
      papers: [],
      excerpts: [],
    };
    this.folders = [folder, ...this.folders];
    this.persistFolders();
    return folder;
  }
  renameFolder(id: string, name: string) {
    const f = this.getFolder(id);
    if (f) {
      f.name = name.trim() || f.name;
      this.persistFolders();
    }
  }
  deleteFolder(id: string) {
    this.folders = this.folders.filter((f) => f.id !== id);
    // Unlink any threads pointing at it.
    for (const t of this.threads) {
      if (t.linkedFolderId === id) t.linkedFolderId = null;
    }
    this.persistFolders();
    this.persistThreads();
  }

  savePaper(folderId: string, paper: Omit<SavedPaper, "savedId" | "savedAt">) {
    const f = this.getFolder(folderId);
    if (!f) return;
    if (f.papers.some((p) => p.arxivId === paper.arxivId)) return; // dedupe
    f.papers = [
      { ...paper, savedId: uid(), savedAt: new Date().toISOString() },
      ...f.papers,
    ];
    this.persistFolders();
  }
  removePaper(folderId: string, savedId: string) {
    const f = this.getFolder(folderId);
    if (!f) return;
    f.papers = f.papers.filter((p) => p.savedId !== savedId);
    this.persistFolders();
  }
  addExcerpt(folderId: string, excerpt: Omit<Excerpt, "id" | "createdAt">) {
    const f = this.getFolder(folderId);
    if (!f) return;
    const clean = {
      text: excerpt.text.trim().slice(0, 20_000),
      note: excerpt.note.trim().slice(0, 8_000),
      source: excerpt.source.trim().slice(0, 2_000),
    };
    if (!clean.text) return;
    if (f.excerpts.some((item) => item.text === clean.text && item.source === clean.source)) return;
    f.excerpts = [
      { ...clean, id: uid(), createdAt: new Date().toISOString() },
      ...f.excerpts,
    ];
    this.persistFolders();
  }
  updateExcerpt(folderId: string, excerptId: string, patch: Partial<Excerpt>) {
    const f = this.getFolder(folderId);
    if (!f) return;
    f.excerpts = f.excerpts.map((e) =>
      e.id === excerptId ? { ...e, ...patch } : e
    );
    this.persistFolders();
  }
  removeExcerpt(folderId: string, excerptId: string) {
    const f = this.getFolder(folderId);
    if (!f) return;
    f.excerpts = f.excerpts.filter((e) => e.id !== excerptId);
    this.persistFolders();
  }

  // ---- Threads ----
  listThreads() {
    return [...this.threads];
  }
  getThread(id: string) {
    return this.threads.find((t) => t.id === id);
  }
  createThread(name: string) {
    const thread: ChatThread = {
      id: uid(),
      name: name.trim() || "Untitled thread",
      createdAt: new Date().toISOString(),
      linkedFolderId: null,
      bookmarks: [],
      messages: [],
    };
    this.threads = [thread, ...this.threads];
    this.persistThreads();
    return thread;
  }
  renameThread(id: string, name: string) {
    const t = this.getThread(id);
    if (t) {
      t.name = name.trim() || t.name;
      this.persistThreads();
    }
  }
  deleteThread(id: string) {
    this.threads = this.threads.filter((t) => t.id !== id);
    this.persistThreads();
  }
  linkFolder(threadId: string, folderId: string | null) {
    const t = this.getThread(threadId);
    if (t) {
      t.linkedFolderId = folderId;
      this.persistThreads();
    }
  }
  addBookmark(threadId: string, bookmark: Omit<Bookmark, "id" | "createdAt">) {
    const t = this.getThread(threadId);
    if (!t) return;
    const clean = {
      ...bookmark,
      title: bookmark.title?.trim().slice(0, 1_000),
      text: bookmark.text?.trim().slice(0, 8_000),
      url: bookmark.url ? webUrl(bookmark.url) || undefined : undefined,
      abstract: bookmark.abstract?.slice(0, 20_000),
    };
    if (clean.kind === "tab" && !clean.url) return;
    t.bookmarks = [
      { ...clean, id: uid(), createdAt: new Date().toISOString() },
      ...t.bookmarks,
    ];
    this.persistThreads();
  }
  removeBookmark(threadId: string, bookmarkId: string) {
    const t = this.getThread(threadId);
    if (!t) return;
    t.bookmarks = t.bookmarks.filter((b) => b.id !== bookmarkId);
    this.persistThreads();
  }
  appendMessage(threadId: string, message: Omit<ChatMessage, "id" | "createdAt">) {
    const t = this.getThread(threadId);
    const full: ChatMessage = {
      ...message,
      id: uid(),
      createdAt: new Date().toISOString(),
    };
    if (t) {
      t.messages = [...t.messages, full];
      this.persistThreads();
    }
    return full;
  }

  // ---- Personalization ----
  buildProfile(): Profile {
    return {
      folders: this.folders.map((f) => {
        const cats = new Set<string>();
        const termSet = new Map<string, number>();
        for (const p of f.papers) {
          for (const c of p.categories) cats.add(c);
          for (const t of terms(`${p.title} ${p.abstract}`)) {
            termSet.set(t, (termSet.get(t) || 0) + 1);
          }
        }
        for (const e of f.excerpts) {
          for (const t of terms(`${e.text} ${e.note}`)) {
            termSet.set(t, (termSet.get(t) || 0) + 1);
          }
        }
        // Include the folder name itself as a hint term.
        for (const t of terms(f.name)) termSet.set(t, (termSet.get(t) || 0) + 2);

        const topTerms = [...termSet.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([t]) => t);

        return { name: f.name, categories: [...cats], terms: topTerms };
      }),
    };
  }

  exportWorkspace(): WorkspaceExport {
    return {
      version: 1,
      source: "rxiver-workspace",
      exportedAt: new Date().toISOString(),
      folders: this.folders,
      threads: this.threads,
    };
  }

  importWorkspace(value: unknown) {
    const normalized = parseWorkspaceExport(value);
    this.folders = normalized.folders;
    this.threads = normalized.threads;
    this.persistFolders();
    this.persistThreads();
    return { folders: this.folders.length, threads: this.threads.length };
  }
}

// The single shared instance the UI imports.
export const repo: Repository = new LocalStorageRepository();
