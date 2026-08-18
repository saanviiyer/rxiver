import { useState } from "react";
import type { Bookmark, ChatThread, Folder } from "../types";
import { chat, folderToContext } from "../lib/api";
import { repo } from "../lib/repository";

interface Props {
  threads: ChatThread[];
  folders: Folder[];
  onCreateThread: (name: string) => void;
  onRenameThread: (id: string, name: string) => void;
  onDeleteThread: (id: string) => void;
  onLinkFolder: (threadId: string, folderId: string | null) => void;
  onAddBookmark: (
    threadId: string,
    bookmark: Omit<Bookmark, "id" | "createdAt">
  ) => void;
  onRemoveBookmark: (threadId: string, bookmarkId: string) => void;
  onMessagesChanged: () => void;
}

export default function Chat({
  threads,
  folders,
  onCreateThread,
  onRenameThread,
  onDeleteThread,
  onLinkFolder,
  onAddBookmark,
  onRemoveBookmark,
  onMessagesChanged,
}: Props) {
  const [newName, setNewName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    threads[0]?.id ?? null
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Bookmark drafts
  const [ideaText, setIdeaText] = useState("");
  const [tabTitle, setTabTitle] = useState("");
  const [tabUrl, setTabUrl] = useState("");

  const selected =
    threads.find((t) => t.id === selectedId) ?? threads[0] ?? null;
  const linkedFolder = selected?.linkedFolderId
    ? folders.find((f) => f.id === selected.linkedFolderId)
    : undefined;

  function addThread() {
    if (!newName.trim()) return;
    onCreateThread(newName.trim());
    setNewName("");
  }

  async function send() {
    if (!selected || !input.trim() || sending) return;
    const content = input.trim();
    setInput("");
    setError("");
    // Persist the user's message immediately.
    repo.appendMessage(selected.id, { role: "user", content });
    onMessagesChanged();
    setSending(true);
    try {
      const fresh = repo.getThread(selected.id)!;
      const res = await chat({
        threadName: fresh.name,
        bookmarks: fresh.bookmarks,
        folder: folderToContext(
          fresh.linkedFolderId ? repo.getFolder(fresh.linkedFolderId) : undefined
        ),
        messages: fresh.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      repo.appendMessage(selected.id, {
        role: "assistant",
        content: res.reply,
        mockMode: res.mockMode,
      });
      onMessagesChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:flex-row">
      {/* Thread list */}
      <div className="w-full shrink-0 md:w-56">
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addThread()}
              placeholder="New chat window"
              className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
            />
            <button
              onClick={addThread}
              className="rounded bg-indigo-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              +
            </button>
          </div>
          <div className="mt-2 space-y-1">
            {threads.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                  selected?.id === t.id
                    ? "bg-indigo-50 font-medium text-indigo-700"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {t.name}
              </button>
            ))}
            {threads.length === 0 && (
              <p className="px-1 py-2 text-xs text-slate-500">
                Create a chat window to start thinking through papers.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Conversation */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Select or create a chat window.
          </div>
        ) : (
          <div className="flex min-h-[70vh] flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-slate-200 p-3">
              <input
                key={selected.id}
                defaultValue={selected.name}
                onBlur={(e) => onRenameThread(selected.id, e.target.value)}
                className="flex-1 rounded border border-transparent px-1 font-semibold text-slate-900 hover:border-slate-200 focus:border-indigo-500 focus:outline-none"
              />
              <select
                value={selected.linkedFolderId ?? ""}
                onChange={(e) =>
                  onLinkFolder(selected.id, e.target.value || null)
                }
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600"
              >
                <option value="">No linked folder</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    Link: {f.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (confirm(`Delete "${selected.name}"?`)) {
                    onDeleteThread(selected.id);
                    setSelectedId(null);
                  }
                }}
                className="rounded border border-slate-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>

            {/* Bookmarks strip */}
            <div className="border-b border-slate-100 p-3">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {selected.bookmarks.map((b) => (
                  <span
                    key={b.id}
                    className="group inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                  >
                    <span className="font-medium text-slate-500">{b.kind}</span>
                    {b.kind === "tab" && b.url ? (
                      <a href={b.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {b.title || b.url}
                      </a>
                    ) : (
                      <span className="max-w-[220px] truncate">
                        {b.title || b.text}
                      </span>
                    )}
                    <button
                      onClick={() => onRemoveBookmark(selected.id, b.id)}
                      className="text-slate-400 hover:text-red-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {selected.bookmarks.length === 0 && (
                  <span className="text-xs text-slate-400">
                    No bookmarks yet — add an idea or a tab below, or bookmark
                    papers from Discover.
                  </span>
                )}
              </div>
              {linkedFolder && (
                <div className="text-xs text-emerald-700">
                  Grounded in folder "{linkedFolder.name}" (
                  {linkedFolder.papers.length} papers, {linkedFolder.excerpts.length}{" "}
                  excerpts)
                </div>
              )}
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <div className="flex flex-1 gap-1">
                  <input
                    value={ideaText}
                    onChange={(e) => setIdeaText(e.target.value)}
                    placeholder="Bookmark an idea…"
                    className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={() => {
                      if (!ideaText.trim()) return;
                      onAddBookmark(selected.id, { kind: "idea", text: ideaText.trim() });
                      setIdeaText("");
                    }}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    + idea
                  </button>
                </div>
                <div className="flex flex-1 gap-1">
                  <input
                    value={tabTitle}
                    onChange={(e) => setTabTitle(e.target.value)}
                    placeholder="Tab title"
                    className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-indigo-500"
                  />
                  <input
                    value={tabUrl}
                    onChange={(e) => setTabUrl(e.target.value)}
                    placeholder="https://…"
                    className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={() => {
                      if (!tabUrl.trim() && !tabTitle.trim()) return;
                      onAddBookmark(selected.id, {
                        kind: "tab",
                        title: tabTitle.trim() || tabUrl.trim(),
                        url: tabUrl.trim(),
                      });
                      setTabTitle("");
                      setTabUrl("");
                    }}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    + tab
                  </button>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 space-y-3 overflow-auto p-3">
              {selected.messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "bg-indigo-600 text-white"
                        : "border border-slate-200 bg-slate-50 text-slate-800"
                    }`}
                  >
                    {m.content}
                    {m.role === "assistant" && m.mockMode && (
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-amber-600">
                        mock
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {selected.messages.length === 0 && (
                <div className="mt-8 text-center text-sm text-slate-400">
                  Ask the assistant to connect your bookmarked papers, surface
                  gaps, or suggest next experiments.
                </div>
              )}
              {sending && (
                <div className="text-xs text-slate-400">Assistant is thinking…</div>
              )}
            </div>

            {/* Input */}
            {error && (
              <div className="border-t border-red-100 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                {error}
              </div>
            )}
            <div className="flex gap-2 border-t border-slate-200 p-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Message the research assistant…"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
              <button
                onClick={send}
                disabled={sending || !input.trim()}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
