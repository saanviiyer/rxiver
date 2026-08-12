// Personalization: bias recommendations toward the categories + terms present
// in the user's saved folders, and attach a short human-readable "why
// recommended" reason to each paper.
//
// Persistence is localStorage-first on the client, so the client passes a
// compact `profile` derived from its saved folders. Shape:
//   profile = { folders: [ { name, categories: [..], terms: [..] } ] }

import { tokenize } from "./rank.js";

// Build fast lookup structures from the profile.
function indexProfile(profile) {
  const catToFolders = new Map(); // category -> Set(folderName)
  const termToFolders = new Map(); // term -> Set(folderName)
  const folders = (profile && profile.folders) || [];

  for (const f of folders) {
    const name = f.name || "a folder";
    for (const c of f.categories || []) {
      if (!catToFolders.has(c)) catToFolders.set(c, new Set());
      catToFolders.get(c).add(name);
    }
    // Terms may arrive pre-tokenized or as free text; normalize either way.
    const terms = (f.terms || []).flatMap((t) => tokenize(String(t)));
    for (const t of terms) {
      if (!termToFolders.has(t)) termToFolders.set(t, new Set());
      termToFolders.get(t).add(name);
    }
  }
  return { catToFolders, termToFolders, hasProfile: folders.length > 0 };
}

/**
 * Re-rank `papers` (already scored by relevance) with a personalization boost
 * and attach `reason` + `personalBoost` fields.
 */
export function personalize(papers, profile) {
  const { catToFolders, termToFolders, hasProfile } = indexProfile(profile);

  const out = papers.map((paper) => {
    let boost = 0;
    const reasons = [];
    const matchedFolders = new Set();

    // Category matches are a strong signal.
    for (const c of paper.categories || []) {
      if (catToFolders.has(c)) {
        boost += 1.5;
        for (const fn of catToFolders.get(c)) matchedFolders.add(fn);
      }
    }

    // Term overlap with saved-folder terms.
    const paperTerms = new Set(tokenize(`${paper.title} ${paper.abstract}`));
    const hitTerms = new Set();
    for (const t of paperTerms) {
      if (termToFolders.has(t)) {
        hitTerms.add(t);
        for (const fn of termToFolders.get(t)) matchedFolders.add(fn);
      }
    }
    boost += Math.min(hitTerms.size, 5) * 0.4;

    let reason = "";
    if (matchedFolders.size > 0) {
      const folderList = [...matchedFolders].slice(0, 2);
      const topTerms = [...hitTerms].slice(0, 3);
      if (topTerms.length > 0) {
        reason = `Matches your "${folderList.join('", "')}" ${
          folderList.length > 1 ? "folders" : "folder"
        } (${topTerms.join(", ")})`;
      } else {
        reason = `Matches the categories in your "${folderList.join('", "')}" ${
          folderList.length > 1 ? "folders" : "folder"
        }`;
      }
    } else if (hasProfile) {
      reason = "Relevant to your search";
    } else {
      reason = "Matches your search";
    }
    if (reasons.length) reason += ` · ${reasons.join(" · ")}`;

    return {
      ...paper,
      personalBoost: boost,
      reason,
      // Combine the base relevance score with the personalization boost.
      finalScore: (paper.score || 0) + boost,
    };
  });

  // Stable re-sort by the combined score.
  return out.sort((a, b) => b.finalScore - a.finalScore);
}

// Derive a small set of extra query terms from the profile, so a bare category
// browse still leans toward what the user cares about.
export function profileTerms(profile, limit = 6) {
  const freq = new Map();
  for (const f of (profile && profile.folders) || []) {
    for (const t of (f.terms || []).flatMap((x) => tokenize(String(x)))) {
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t);
}
