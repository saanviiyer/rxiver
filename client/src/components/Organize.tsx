import { useState } from "react";
import type { Folder, GlossExcerptExport } from "../types";
import { citationFilename, formatApa, formatFolderBibTeX } from "../lib/cite";

interface Props {
  folders: Folder[];
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onAddExcerpt: (
    folderId: string,
    excerpt: { text: string; note: string; source: string }
  ) => void;
  onRemoveExcerpt: (folderId: string, excerptId: string) => void;
  onRemovePaper: (folderId: string, savedId: string) => void;
  onAnalyzeFolder: (folder: Folder) => Promise<string>;
}

export default function Organize({
  folders,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onAddExcerpt,
  onRemoveExcerpt,
  onRemovePaper,
  onAnalyzeFolder,
}: Props) {
  const [newName, setNewName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    folders[0]?.id ?? null
  );

  const selected =
    folders.find((f) => f.id === selectedId) ?? folders[0] ?? null;

  // Excerpt draft
  const [exText, setExText] = useState("");
  const [exNote, setExNote] = useState("");
  const [exSource, setExSource] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [notice, setNotice] = useState("");

  function download(name: string, contents: string, type: string) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function importGloss(file: File) {
    if (!selected) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Gloss export is larger than 5 MB.");
      const value = JSON.parse(await file.text()) as GlossExcerptExport;
      if (value.version !== 1 || value.source !== "rxiver-gloss" || !Array.isArray(value.excerpts)) {
        throw new Error("Not a rxiver gloss export");
      }
      const excerpts = value.excerpts.slice(0, 5_000).filter(
        (excerpt) => excerpt && typeof excerpt.text === "string" && excerpt.text.trim()
      );
      for (const excerpt of excerpts) {
        onAddExcerpt(selected.id, {
          text: excerpt.text.slice(0, 20_000),
          note: typeof excerpt.note === "string" ? excerpt.note.slice(0, 8_000) : "",
          source: typeof excerpt.source === "string" ? excerpt.source.slice(0, 2_000) : "",
        });
      }
      setNotice(`Imported ${excerpts.length} Gloss excerpt${excerpts.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Import failed");
    }
  }

  function addFolder() {
    if (!newName.trim()) return;
    onCreateFolder(newName.trim());
    setNewName("");
  }

  function submitExcerpt() {
    if (!selected || !exText.trim()) return;
    onAddExcerpt(selected.id, {
      text: exText.trim(),
      note: exNote.trim(),
      source: exSource.trim(),
    });
    setExText("");
    setExNote("");
    setExSource("");
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:flex-row">
      {/* Folder list */}
      <div className="w-full shrink-0 md:w-64">
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addFolder()}
              placeholder="New folder"
              className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
            />
            <button
              onClick={addFolder}
              className="rounded bg-indigo-600 px-2 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              +
            </button>
          </div>
          <div className="mt-2 space-y-1">
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedId(f.id)}
                className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                  selected?.id === f.id
                    ? "bg-indigo-50 font-medium text-indigo-700"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {f.name}
                <span className="ml-1 text-xs text-slate-400">
                  {f.papers.length + f.excerpts.length}
                </span>
              </button>
            ))}
            {folders.length === 0 && (
              <p className="px-1 py-2 text-xs text-slate-500">
                No folders yet. Create one to start saving papers and excerpts.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Folder detail */}
      <div className="min-w-0 flex-1">
        {!selected ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Select or create a folder.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                key={selected.id}
                defaultValue={selected.name}
                onBlur={(e) => onRenameFolder(selected.id, e.target.value)}
                className="flex-1 rounded border border-transparent px-1 text-lg font-semibold text-slate-900 hover:border-slate-200 focus:border-indigo-500 focus:outline-none"
              />
              <button
                onClick={() => {
                  if (confirm(`Delete folder "${selected.name}"?`)) {
                    onDeleteFolder(selected.id);
                    setSelectedId(null);
                  }
                }}
                className="rounded border border-slate-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
              >
                Delete folder
              </button>
            </div>

            <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <button
                disabled={selected.papers.length === 0}
                onClick={() => void navigator.clipboard.writeText(selected.papers.map(formatApa).join("\n\n"))}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
              >
                Copy APA citations
              </button>
              <button
                disabled={selected.papers.length === 0}
                onClick={() => download(citationFilename(selected.name), formatFolderBibTeX(selected.papers), "application/x-bibtex")}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
              >
                Download BibTeX
              </button>
              <label className="cursor-pointer rounded border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">
                Import from rxiver gloss
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importGloss(file);
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                disabled={analyzing || selected.papers.length === 0}
                onClick={async () => {
                  setAnalyzing(true);
                  try { setAnalysis(await onAnalyzeFolder(selected)); }
                  catch (error) { setAnalysis(error instanceof Error ? error.message : "Analysis failed"); }
                  finally { setAnalyzing(false); }
                }}
                className="ml-auto rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                {analyzing ? "Analyzing…" : "Analyze collection"}
              </button>
            </div>

            {analysis && (
              <div className="whitespace-pre-wrap rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm leading-relaxed text-slate-700">
                <div className="mb-2 font-semibold text-indigo-800">Collection synthesis</div>
                {analysis}
              </div>
            )}
            {notice && (
              <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700" role="status">
                {notice}
              </div>
            )}

            {/* Add excerpt */}
            <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800">
                Add an excerpt
              </h3>
              <textarea
                value={exText}
                onChange={(e) => setExText(e.target.value)}
                placeholder="Paste a highlighted snippet…"
                rows={2}
                className="mt-2 w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
              />
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  value={exNote}
                  onChange={(e) => setExNote(e.target.value)}
                  placeholder="Your note (optional)"
                  className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
                />
                <input
                  value={exSource}
                  onChange={(e) => setExSource(e.target.value)}
                  placeholder="Source link / citation"
                  className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
                />
                <button
                  onClick={submitExcerpt}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Saved papers */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">
                Saved papers ({selected.papers.length})
              </h3>
              <div className="space-y-2">
                {selected.papers.map((p) => (
                  <div
                    key={p.savedId}
                    className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <a
                        href={p.absUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-slate-900 hover:text-indigo-600"
                      >
                        {p.title}
                      </a>
                      <button
                        onClick={() => onRemovePaper(selected.id, p.savedId)}
                        className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                      >
                        remove
                      </button>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      arXiv:{p.arxivId} · {p.categories.slice(0, 3).join(", ")}
                    </div>
                  </div>
                ))}
                {selected.papers.length === 0 && (
                  <p className="text-xs text-slate-500">
                    No papers yet — save some from Discover.
                  </p>
                )}
              </div>
            </div>

            {/* Excerpts */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">
                Excerpts ({selected.excerpts.length})
              </h3>
              <div className="space-y-2">
                {selected.excerpts.map((e) => (
                  <div
                    key={e.id}
                    className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm italic text-slate-700">"{e.text}"</p>
                      <button
                        onClick={() => onRemoveExcerpt(selected.id, e.id)}
                        className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                      >
                        remove
                      </button>
                    </div>
                    {e.note && (
                      <p className="mt-1 text-xs text-slate-600">Note: {e.note}</p>
                    )}
                    {e.source && (
                      <a
                        href={e.source.startsWith("http") ? e.source : undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block truncate text-xs text-indigo-600 hover:underline"
                      >
                        {e.source}
                      </a>
                    )}
                  </div>
                ))}
                {selected.excerpts.length === 0 && (
                  <p className="text-xs text-slate-500">No excerpts yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
