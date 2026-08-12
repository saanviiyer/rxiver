// Server-side PDF text extraction using unpdf (a serverless build of pdf.js —
// pure JS, no native deps, robust on real-world PDF exports where the older
// pdf-parse choked). Also derives a short search query from the extracted text.
import { extractText, getDocumentProxy } from "unpdf";
import { tokenize } from "./rank.js";

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB

export async function extractPdfText(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  const merged = typeof text === "string" ? text : (text || []).join("\n");
  return merged.trim();
}

// Try to isolate the abstract region — that's the densest signal for finding
// similar work. Falls back to the first chunk of text.
export function abstractRegion(text = "") {
  const lower = text.toLowerCase();
  const start = lower.indexOf("abstract");
  if (start !== -1) {
    // Cut at the next section marker after the abstract.
    const rest = text.slice(start + "abstract".length);
    const endMarkers = [
      /\n\s*1\s+introduction/i,
      /\n\s*introduction\b/i,
      /\n\s*index terms\b/i,
      /\n\s*keywords\b/i,
      /\n\s*i\.\s+introduction/i,
    ];
    let cut = rest.length;
    for (const re of endMarkers) {
      const m = re.exec(rest);
      if (m && m.index > 40) cut = Math.min(cut, m.index);
    }
    const region = rest.slice(0, Math.min(cut, 2000)).trim();
    if (region.length > 60) return region;
  }
  return text.slice(0, 1500).trim();
}

// Derive a compact query: the most frequent meaningful terms in the abstract
// region, plus a best-guess title from the first non-trivial line.
export function deriveQuery(text = "") {
  const region = abstractRegion(text);
  const terms = tokenize(region);
  const freq = new Map();
  for (const t of terms) freq.set(t, (freq.get(t) || 0) + 1);
  const top = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t);

  const firstLine =
    (text.split("\n").map((l) => l.trim()).find((l) => l.length > 15) || "").slice(
      0,
      120
    );

  return {
    query: top.join(" "),
    keyTerms: top,
    guessedTitle: firstLine,
    abstractPreview: region.slice(0, 600),
  };
}
