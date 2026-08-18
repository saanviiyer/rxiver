import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./index.js";

test("HTTP API applies security headers and validates requests", async (t) => {
  const server = startServer(0);
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await health.json()).ok, true);

  const invalid = await fetch(`${base}/api/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ category: "cs.LG OR all:*" }),
  });
  assert.equal(invalid.status, 400);

  const malformed = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);

  const missing = await fetch(`${base}/api/does-not-exist`);
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /not found/i);
});
