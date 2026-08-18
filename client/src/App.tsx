import { useEffect, useRef, useState } from "react";
import type { Bookmark, ChatThread, Folder, Paper } from "./types";
import { repo } from "./lib/repository";
import { analyzeFolder, getHealth, getRefreshStatus, runRefresh, type Health } from "./lib/api";
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
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const restoreRef = useRef<HTMLInputElement>(null);

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

  function exportWorkspace() {
    const payload = JSON.stringify(repo.exportWorkspace(), null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rxiver-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setWorkspaceNotice("Workspace backup downloaded.");
  }

  async function restoreWorkspace(file: File) {
    try {
      const result = repo.importWorkspace(JSON.parse(await file.text()));
      syncFolders();
      syncThreads();
      setWorkspaceNotice(`Restored ${result.folders} folders and ${result.threads} chat windows.`);
    } catch (error) {
      setWorkspaceNotice(error instanceof Error ? error.message : "Restore failed.");
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
      published: paper.published,
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
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold text-indigo-600">rxiver</span>
            <span className="hidden text-xs text-slate-400 sm:inline">
              AI research workspace
            </span>
          </div>

          <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
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

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 text-xs">
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
            {health?.interactiveRefresh && (
              <button
                onClick={doRefresh}
                disabled={refreshing}
                title={refreshInfo}
                className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {refreshing ? "Refreshing…" : "Refresh corpus"}
              </button>
            )}
            <button
              onClick={exportWorkspace}
              title="Download all folders, excerpts, papers, bookmarks, and chats"
              className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
            >
              Back up
            </button>
            <button
              onClick={() => restoreRef.current?.click()}
              title="Replace this browser's workspace from a validated rxiver backup"
              className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
            >
              Restore
            </button>
            <input
              ref={restoreRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file && confirm("Replace this browser's rxiver workspace with the selected backup?")) {
                  void restoreWorkspace(file);
                }
                event.target.value = "";
              }}
            />
          </div>
        </div>
        {refreshInfo && (
          <div className="mx-auto max-w-6xl px-4 pb-2 text-[11px] text-slate-400">
            {refreshInfo}
          </div>
        )}
        {workspaceNotice && (
          <div className="mx-auto max-w-6xl px-4 pb-2 text-[11px] text-indigo-600" role="status">
            {workspaceNotice}
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
            onAnalyzeFolder={async (folder) => (await analyzeFolder(folder)).reply}
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
