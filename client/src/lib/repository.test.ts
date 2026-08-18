import { describe, expect, it } from "vitest";
import { parseWorkspaceExport, repo } from "./repository";

const emptyBackup = {
  version: 1 as const,
  source: "rxiver-workspace" as const,
  exportedAt: new Date().toISOString(),
  folders: [],
  threads: [],
};

describe("workspace backup", () => {
  it("rejects unknown formats", () => {
    expect(() => parseWorkspaceExport({ version: 99 })).toThrow(/supported/);
  });

  it("normalizes data and removes dangling folder links and unsafe tab URLs", () => {
    const result = parseWorkspaceExport({
      ...emptyBackup,
      folders: [{ id: "folder", name: "Papers", papers: [], excerpts: [] }],
      threads: [{
        id: "thread", name: "Notes", linkedFolderId: "missing",
        bookmarks: [{ id: "bad", kind: "tab", url: "javascript:alert(1)" }], messages: [],
      }],
    });
    expect(result.threads[0].linkedFolderId).toBeNull();
    expect(result.threads[0].bookmarks[0].url).toBeUndefined();
  });

  it("round-trips a workspace and deduplicates identical excerpts", () => {
    repo.importWorkspace(emptyBackup);
    const folder = repo.createFolder("Reading");
    const excerpt = { text: "Evidence", note: "", source: "https://example.test" };
    repo.addExcerpt(folder.id, excerpt);
    repo.addExcerpt(folder.id, excerpt);
    expect(repo.exportWorkspace().folders[0].excerpts).toHaveLength(1);
  });
});
