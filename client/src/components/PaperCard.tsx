import { useState } from "react";
import type { Folder, Paper } from "../types";

interface Props {
  paper: Paper;
  folders: Folder[];
  onSaveToFolder: (folderId: string, paper: Paper) => void;
  onBookmark?: (paper: Paper) => void;
}

export default function PaperCard({
  paper,
  folders,
  onSaveToFolder,
  onBookmark,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const authors =
    paper.authors.length > 4
      ? `${paper.authors.slice(0, 4).join(", ")} +${paper.authors.length - 4}`
      : paper.authors.join(", ");

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <a
          href={paper.absUrl}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-slate-900 hover:text-indigo-600"
        >
          {paper.title}
        </a>
        <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
          {paper.id}
        </span>
      </div>

      <div className="mt-1 text-xs text-slate-500">
        {authors} · {(paper.published || "").slice(0, 10)}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {paper.categories.slice(0, 5).map((c) => (
          <span
            key={c}
            className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700"
          >
            {c}
          </span>
        ))}
      </div>

      {paper.reason && (
        <div className="mt-2 text-xs font-medium text-emerald-700">
          ★ {paper.reason}
        </div>
      )}

      <p className="mt-2 text-sm leading-relaxed text-slate-700">
        {expanded ? paper.abstract : `${paper.abstract.slice(0, 240)}${paper.abstract.length > 240 ? "…" : ""}`}
      </p>
      {paper.abstract.length > 240 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-xs font-medium text-indigo-600 hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={paper.pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          PDF
        </a>

        <div className="relative">
          <button
            onClick={() => setSaveOpen((o) => !o)}
            className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Save to folder ▾
          </button>
          {saveOpen && (
            <div className="absolute z-10 mt-1 w-56 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
              {folders.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-slate-500">
                  No folders yet — create one in Organize.
                </div>
              )}
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    onSaveToFolder(f.id, paper);
                    setSaveOpen(false);
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-indigo-50"
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {onBookmark && (
          <button
            onClick={() => onBookmark(paper)}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            Bookmark to thread
          </button>
        )}
      </div>
    </div>
  );
}
