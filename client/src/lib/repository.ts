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
  private folders: Folder[] = read<Folder[]>(FOLDERS_KEY, []);
  private threads: ChatThread[] = read<ChatThread[]>(THREADS_KEY, []);

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
    f.excerpts = [
      { ...excerpt, id: uid(), createdAt: new Date().toISOString() },
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
    t.bookmarks = [
      { ...bookmark, id: uid(), createdAt: new Date().toISOString() },
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
}

// The single shared instance the UI imports.
export const repo: Repository = new LocalStorageRepository();
