// Routine arXiv corpus refresh.
//
// Fetches the latest papers for a set of followed categories and writes them to
// an on-disk cache (server/.cache/refresh.json). This keeps rxiver's semantic
// index fresh WITHOUT any model training — it's an updated corpus snapshot plus
// personalization, which is the honest version of "retrains on arXiv".
//
// Run manually:      npm run refresh
// Run via endpoint:  POST /api/refresh   (optionally { categories: [...] })
// Run daily (cron):  see README (crontab / launchd / Render cron job).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { latestInCategory } from "./arxiv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "refresh.json");

function defaultCategories() {
  return (process.env.REFRESH_CATEGORIES || "cs.LG,cs.AI,cs.CL")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Refresh the cached corpus for the given categories (or the env default).
 * @returns {Promise<{refreshedAt, categories, counts, total}>}
 */
export async function runRefresh(categories) {
  const cats = categories && categories.length ? categories : defaultCategories();
  const byCategory = {};
  const counts = {};

  for (const cat of cats) {
    try {
      const { papers } = await latestInCategory(cat, 25);
      byCategory[cat] = papers;
      counts[cat] = papers.length;
    } catch (err) {
      byCategory[cat] = [];
      counts[cat] = 0;
      console.warn(`refresh: category ${cat} failed: ${err.message}`);
    }
  }

  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const snapshot = {
    refreshedAt: new Date().toISOString(),
    categories: cats,
    counts,
    total,
    byCategory,
  };

  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(snapshot, null, 2), "utf-8");
  return { refreshedAt: snapshot.refreshedAt, categories: cats, counts, total };
}

/** Read the last refresh snapshot, or null if none exists yet. */
export async function readSnapshot() {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Allow running as a standalone script: `node server/refresh.js` / `npm run refresh`.
if (import.meta.url === `file://${process.argv[1]}`) {
  runRefresh()
    .then((r) => {
      console.log(
        `rxiver refresh complete: ${r.total} papers across ${r.categories.length} categories`
      );
      console.log(JSON.stringify(r.counts, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("refresh failed:", err.message);
      process.exit(1);
    });
}
