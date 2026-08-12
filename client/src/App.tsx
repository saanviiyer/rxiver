import { useEffect, useState } from "react";
import type { Bookmark, ChatThread, Folder, Paper } from "./types";
import { repo } from "./lib/repository";
import { getHealth, getRefreshStatus, runRefresh, type Health } from "./lib/api";
import Discover from "./components/Discover";
import Organize from "./components/Organize";
import Chat from "./components/Chat";

type Tab = "discover" | "organize" | "chat";

export default function App() {
  const [tab, setTab] = useState<Tab>("discover");
  const [folders, setFolders] = useState<Folder[]>(repo.listFolders());
  const [threads, setThreads] = useState<ChatThread[]>(repo.listThreads());
  const [health, setHealth] = useState<Health | null>(null);
  const [refreshInfo, setRefreshInfo] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);

  // Re-read from the repository after any mutation.
  const syncFolders = () => setFolders(repo.listFolders());
  const syncThreads = () => setThreads(repo.listThreads());

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null));
    getRefreshStatus()
      .then((r) => {
        if (r.refreshedAt) {
          setRefreshInfo(
            `Corpus last refreshed ${new Date(r.refreshedAt).toLocaleString()} (${r.total} papers)`
          );
        } else {
          setRefreshInfo("Corpus not refreshed yet");
        }
      })
      .catch(() => {});
  }, []);

  async function doRefresh() {
    setRefreshing(true);
    try {
      const r = await runRefresh();
      setRefreshInfo(
        `Corpus refreshed ${new Date(r.refreshedAt!).toLocaleString()} (${r.total} papers across ${
          r.categories?.length ?? 0
        } categories)`
      );
    } catch {
      setRefreshInfo("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  // ---- Folder actions ----
  const saveToFolder = (folderId: string, paper: Paper) => {
    repo.savePaper(folderId, {
      arxivId: paper.id,
      title: paper.title,
      authors: paper.authors,
      abstract: paper.abstract,
      categories: paper.categories,
      absUrl: paper.absUrl,
      pdfUrl: paper.pdfUrl,
    });
    syncFolders();
  };

  // ---- Thread actions ----
  const bookmarkToThread = (threadId: string, paper: Paper) => {
    repo.addBookmark(threadId, {
      kind: "paper",
      title: paper.title,
      arxivId: paper.id,
      abstract: paper.abstract,
    });
    syncThreads();
  };

  const addBookmark = (
    threadId: string,
    bookmark: Omit<Bookmark, "id" | "createdAt">
  ) => {
    repo.addBookmark(threadId, bookmark);
    syncThreads();
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "discover", label: "Discover" },
    { id: "organize", label: "Organize" },
    { id: "chat", label: "Chat windows" },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold text-indigo-600">rxiver</span>
            <span className="hidden text-xs text-slate-400 sm:inline">
              AI research workspace
            </span>
          </div>

          <nav className="flex gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  tab === t.id
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-xs">
            {health && (
              <span
                className={`rounded-full px-2 py-0.5 ${
                  health.mockMode
                    ? "bg-amber-50 text-amber-700"
                    : "bg-emerald-50 text-emerald-700"
                }`}
                title={`ranking: ${health.ranking}`}
              >
                {health.mockMode ? "Mock AI" : `Live · ${health.model}`}
              </span>
            )}
            <button
              onClick={doRefresh}
              disabled={refreshing}
              title={refreshInfo}
              className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh corpus"}
            </button>
          </div>
        </div>
        {refreshInfo && (
          <div className="mx-auto max-w-6xl px-4 pb-2 text-[11px] text-slate-400">
            {refreshInfo}
          </div>
        )}
      </header>

      <main className="flex-1">
        {tab === "discover" && (
          <Discover
            folders={folders}
            threads={threads}
            onSaveToFolder={saveToFolder}
            onBookmarkToThread={bookmarkToThread}
          />
        )}
        {tab === "organize" && (
          <Organize
            folders={folders}
            onCreateFolder={(name) => {
              repo.createFolder(name);
              syncFolders();
            }}
            onRenameFolder={(id, name) => {
              repo.renameFolder(id, name);
              syncFolders();
            }}
            onDeleteFolder={(id) => {
              repo.deleteFolder(id);
              syncFolders();
              syncThreads();
            }}
            onAddExcerpt={(folderId, ex) => {
              repo.addExcerpt(folderId, ex);
              syncFolders();
            }}
            onRemoveExcerpt={(folderId, exId) => {
              repo.removeExcerpt(folderId, exId);
              syncFolders();
            }}
            onRemovePaper={(folderId, savedId) => {
              repo.removePaper(folderId, savedId);
              syncFolders();
            }}
          />
        )}
        {tab === "chat" && (
          <Chat
            threads={threads}
            folders={folders}
            onCreateThread={(name) => {
              repo.createThread(name);
              syncThreads();
            }}
            onRenameThread={(id, name) => {
              repo.renameThread(id, name);
              syncThreads();
            }}
            onDeleteThread={(id) => {
              repo.deleteThread(id);
              syncThreads();
            }}
            onLinkFolder={(threadId, folderId) => {
              repo.linkFolder(threadId, folderId);
              syncThreads();
            }}
            onAddBookmark={addBookmark}
            onRemoveBookmark={(threadId, bookmarkId) => {
              repo.removeBookmark(threadId, bookmarkId);
              syncThreads();
            }}
            onMessagesChanged={syncThreads}
          />
        )}
      </main>
    </div>
  );
}
