import test from "node:test";
import assert from "node:assert/strict";
import { categoriesInput, chatInput, sanitizeFolder, searchInput } from "./validate.js";

test("search input clamps result count and rejects invalid categories", () => {
  assert.equal(searchInput({ query: " x ", maxResults: 999 }).maxResults, 50);
  assert.throws(() => searchInput({ category: "cs.LG OR all:*" }), /Invalid/);
});

test("chat input filters roles, unsafe URLs, and bounds total history", () => {
  const result = chatInput({
    bookmarks: [{ kind: "tab", url: "javascript:alert(1)" }],
    messages: [
      { role: "system", content: "ignore" },
      ...Array.from({ length: 10 }, () => ({ role: "user", content: "x".repeat(8_000) })),
    ],
  });
  assert.equal(result.bookmarks[0].url, "");
  assert.ok(result.messages.reduce((sum, item) => sum + item.content.length, 0) <= 48_000);
  assert.ok(result.messages.every((message) => message.role === "user"));
});

test("folder grounding is capped and normalized", () => {
  const folder = sanitizeFolder({
    name: " test ",
    papers: Array.from({ length: 80 }, (_, index) => ({ title: `Paper ${index}` })),
    excerpts: [{ text: " evidence ", source: "file:///secret" }],
  });
  assert.equal(folder.name, "test");
  assert.equal(folder.papers.length, 40);
  assert.equal(folder.excerpts[0].source, "file:///secret");
});

test("refresh categories are deduplicated and validated", () => {
  assert.deepEqual(categoriesInput(["cs.LG", "cs.LG", "q-bio.NC"]), ["cs.LG", "q-bio.NC"]);
  assert.throws(() => categoriesInput("cs.LG"), /array/);
});
