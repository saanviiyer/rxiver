import test from "node:test";
import assert from "node:assert/strict";
import { buildContext, chat } from "./ai.js";

const folder = {
  name: "Robust learning",
  papers: [{ title: "Calibrated Models", arxivId: "2401.00001", authors: ["A. Author"], abstract: "Calibration under shift.", categories: ["cs.LG"] }],
  excerpts: [{ text: "Accuracy fell under shift", note: "Key limitation", source: "https://example.test" }],
};

test("grounding context includes paper metadata and excerpts", () => {
  const context = buildContext({ threadName: "Review", folder });
  assert.match(context, /Calibrated Models/);
  assert.match(context, /Calibration under shift/);
  assert.match(context, /Key limitation/);
});

test("mock collection synthesis does not crash with paper bookmarks", async () => {
  const result = await chat(
    { threadName: "Review", folder, bookmarks: [{ kind: "paper", title: "A paper" }] },
    [{ role: "user", content: "Synthesize this collection" }]
  );
  assert.equal(result.mockMode, true);
  assert.match(result.reply, /Three grounded next questions/);
});
