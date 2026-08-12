import { useRef, useState } from "react";
import type { ChatThread, Folder, Paper } from "../types";
import { search, similarFromPdf } from "../lib/api";
import { repo } from "../lib/repository";
import PaperCard from "./PaperCard";

interface Props {
  folders: Folder[];
  threads: ChatThread[];
  onSaveToFolder: (folderId: string, paper: Paper) => void;
  onBookmarkToThread: (threadId: string, paper: Paper) => void;
}

const CATEGORIES = [
  { value: "", label: "Any category" },
  { value: "cs.LG", label: "cs.LG — Machine Learning" },
  { value: "cs.AI", label: "cs.AI — Artificial Intelligence" },
  { value: "cs.CL", label: "cs.CL — Computation & Language" },
  { value: "cs.CV", label: "cs.CV — Computer Vision" },
  { value: "cs.NE", label: "cs.NE — Neural & Evolutionary" },
  { value: "stat.ML", label: "stat.ML — Statistics / ML" },
  { value: "q-bio.NC", label: "q-bio.NC — Neurons & Cognition" },
  { value: "eess.IV", label: "eess.IV — Image & Video" },
];

export default function Discover({
  folders,
  threads,
  onSaveToFolder,
  onBookmarkToThread,
}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sortBy, setSortBy] = useState<"relevance" | "submittedDate">("relevance");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<string>("");
  const [derived, setDerived] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [bookmarkTarget, setBookmarkTarget] = useState<Paper | null>(null);

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim() && !category) {
      setError("Enter a keyword or pick a category.");
      return;
    }
    setLoading(true);
    setError("");
    setDerived("");
    try {
      const res = await search({
        query,
        category,
        sortBy,
        maxResults: 25,
        profile: repo.buildProfile(),
      });
      setPapers(res.papers);
      setMeta(
        `${res.count} results · ranked by ${res.rankingMethod}${
          res.cached ? " · cached" : ""
        }`
      );
    } catch (err) {
      setError((err as Error).message);
      setPapers([]);
    } finally {
      setLoading(false);
    }
  }

  async function onPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError("");
    setMeta("");
    setDerived("");
    try {
      const res = await similarFromPdf(file, repo.buildProfile());
      setPapers(res.papers);
      setDerived(
        `From "${res.filename}" → key terms: ${res.derived.keyTerms.join(", ")}`
      );
      setMeta(`${res.papers.length} similar papers · ranked by ${res.rankingMethod}`);
    } catch (err) {
      setError((err as Error).message);
      setPapers([]);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-4">
      <form onSubmit={runSearch} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search arXiv by topic or keyword (e.g. continual learning)"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-slate-600">
            <input
              type="checkbox"
              checked={sortBy === "submittedDate"}
              onChange={(e) => setSortBy(e.target.checked ? "submittedDate" : "relevance")}
            />
            Newest first
          </label>

          <div className="ml-auto">
            <label className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50">
              Upload PDF → find similar
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={onPdf}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </form>

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {derived && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {derived}
        </div>
      )}
      {meta && <div className="mt-3 text-xs text-slate-500">{meta}</div>}

      <div className="mt-4 space-y-3">
        {papers.map((p) => (
          <PaperCard
            key={p.id}
            paper={p}
            folders={folders}
            onSaveToFolder={onSaveToFolder}
            onBookmark={threads.length > 0 ? (paper) => setBookmarkTarget(paper) : undefined}
          />
        ))}
        {!loading && papers.length === 0 && !error && (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Search arXiv or upload a PDF to get recommendations. Results are
            biased toward the topics in your saved folders.
          </div>
        )}
      </div>

      {bookmarkTarget && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setBookmarkTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-slate-900">
              Bookmark into which thread?
            </h3>
            <p className="mt-1 truncate text-xs text-slate-500">{bookmarkTarget.title}</p>
            <div className="mt-3 max-h-64 space-y-1 overflow-auto">
              {threads.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    onBookmarkToThread(t.id, bookmarkTarget);
                    setBookmarkTarget(null);
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-indigo-50"
                >
                  {t.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => setBookmarkTarget(null)}
              className="mt-3 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
