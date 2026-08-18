import { describe, expect, it } from "vitest";
import { citationFilename, formatBibTeX, paperYear } from "./cite";
import type { SavedPaper } from "../types";

const paper: SavedPaper = { savedId: "1", arxivId: "2401.01234", title: "Attention & Research", authors: ["Ada Lovelace"], abstract: "", categories: ["cs.AI"], absUrl: "https://arxiv.org/abs/2401.01234", pdfUrl: "", published: "2024-01-03", savedAt: "" };

describe("citations", () => {
  it("formats arXiv BibTeX", () => {
    expect(formatBibTeX(paper)).toContain("@misc{lovelace2024attention");
    expect(formatBibTeX(paper)).toContain("Attention \\& Research");
  });
  it("derives year and safe filename", () => {
    expect(paperYear(paper)).toBe(2024);
    expect(citationFilename("My Reading List")).toBe("my-reading-list.bib");
  });
});
