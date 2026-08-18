import type { SavedPaper } from "../types";

export function paperYear(paper: SavedPaper): number | null {
  const publishedYear = paper.published?.slice(0, 4);
  if (publishedYear && /^\d{4}$/.test(publishedYear)) return Number(publishedYear);
  const prefix = paper.arxivId.match(/^(\d{2})\d{2}\./)?.[1];
  if (!prefix) return null;
  const year = Number(prefix);
  return year >= 91 ? 1900 + year : 2000 + year;
}

export function citeKey(paper: SavedPaper): string {
  const authorParts = (paper.authors[0] || "anon").split(/\s+/);
  const family = authorParts[authorParts.length - 1]?.toLowerCase().replace(/[^a-z0-9]/g, "") || "anon";
  const word = paper.title.toLowerCase().match(/[a-z0-9]+/g)?.find((value) => !["a", "an", "the", "of", "in", "for"].includes(value)) || "paper";
  return `${family}${paperYear(paper) || ""}${word}`;
}

function escapeBib(value: string): string {
  return value.replace(/([&%$#_])/g, "\\$1");
}

export function formatBibTeX(paper: SavedPaper, key = citeKey(paper)): string {
  const fields = [
    `  title = {${escapeBib(paper.title)}}`,
    `  author = {${paper.authors.map(escapeBib).join(" and ")}}`,
    paperYear(paper) ? `  year = {${paperYear(paper)}}` : "",
    `  eprint = {${paper.arxivId}}`,
    "  archivePrefix = {arXiv}",
    paper.categories[0] ? `  primaryClass = {${paper.categories[0]}}` : "",
    `  url = {${paper.absUrl}}`,
  ].filter(Boolean);
  return `@misc{${key},\n${fields.join(",\n")}\n}`;
}

export function formatFolderBibTeX(papers: SavedPaper[]): string {
  const seen = new Map<string, number>();
  return papers.map((paper) => {
    const base = citeKey(paper);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return formatBibTeX(paper, count ? `${base}${String.fromCharCode(97 + count)}` : base);
  }).join("\n\n");
}

export function formatApa(paper: SavedPaper): string {
  const authors = paper.authors.join(", ") || "Unknown author";
  const year = paperYear(paper) || "n.d.";
  return `${authors} (${year}). ${paper.title}. arXiv:${paper.arxivId}. ${paper.absUrl}`;
}

export function citationFilename(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "citations";
  return `${base}.bib`;
}
