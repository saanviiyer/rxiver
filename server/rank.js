// Candidate ranking for "papers similar to X".
//
// Default path: a zero-dependency lexical scorer (BM25 over title+abstract vs
// the query). Optional path: if an embeddings provider is configured via env,
// rank by cosine similarity over semantic embeddings instead. The app is fully
// functional with NO embeddings key — it simply falls back to BM25.

const EMBEDDINGS_PROVIDER = process.env.EMBEDDINGS_PROVIDER || "";
const EMBEDDINGS_API_KEY = process.env.EMBEDDINGS_API_KEY || "";
const EMBEDDINGS_MODEL = process.env.EMBEDDINGS_MODEL || "";

export const embeddingsEnabled = Boolean(EMBEDDINGS_PROVIDER && EMBEDDINGS_API_KEY);

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in into is it its of on or that the their this to was were with we our you your which using across also can may not more most other than then they these those such via using paper method model results show approach based propose present study new et al fig figure table section eq equation".split(
    " "
  )
);

export function tokenize(text = "") {
  return (text.toLowerCase().match(/[a-z][a-z0-9+.#-]{1,}/g) || [])
    .map((w) => w.replace(/[.\-#+]+$/, "")) // drop trailing punctuation (e.g. "al.")
    .filter((w) => !STOPWORDS.has(w) && w.length > 1);
}

// ---- BM25 lexical ranker ---------------------------------------------------

function docText(paper) {
  return `${paper.title || ""} ${paper.abstract || ""}`;
}

/**
 * Score `candidates` against a free-text `query` using BM25.
 * Returns candidates with an added { score } field, sorted desc.
 */
export function bm25Rank(query, candidates) {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || candidates.length === 0) {
    return candidates.map((p) => ({ ...p, score: 0 }));
  }

  const docs = candidates.map((p) => tokenize(docText(p)));
  const N = docs.length;
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / N || 1;

  // Document frequency per term.
  const df = new Map();
  for (const terms of docs) {
    for (const t of new Set(terms)) df.set(t, (df.get(t) || 0) + 1);
  }

  const k1 = 1.5;
  const b = 0.75;
  const qset = new Set(queryTerms);

  const scored = candidates.map((paper, i) => {
    const terms = docs[i];
    const dl = terms.length || 1;
    const tf = new Map();
    for (const t of terms) if (qset.has(t)) tf.set(t, (tf.get(t) || 0) + 1);

    let score = 0;
    for (const t of qset) {
      const f = tf.get(t) || 0;
      if (f === 0) continue;
      const n = df.get(t) || 0;
      // BM25 idf with +1 floor so common-but-present terms stay non-negative.
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * dl) / avgdl)));
    }
    return { ...paper, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}

// ---- Optional semantic embeddings ------------------------------------------

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Call a generic OpenAI-compatible embeddings endpoint.
// POST { input: [...] } -> { data: [{ embedding: [...] }, ...] }
async function embed(texts) {
  const body = { input: texts };
  if (EMBEDDINGS_MODEL) body.model = EMBEDDINGS_MODEL;
  const res = await fetch(EMBEDDINGS_PROVIDER, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${EMBEDDINGS_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`embeddings provider responded ${res.status}`);
  const json = await res.json();
  const data = json.data || json.embeddings || [];
  return data.map((d) => d.embedding || d);
}

async function embeddingRank(query, candidates) {
  const texts = [query, ...candidates.map(docText)];
  const vectors = await embed(texts);
  const [qVec, ...docVecs] = vectors;
  const scored = candidates.map((paper, i) => ({
    ...paper,
    score: cosine(qVec, docVecs[i] || []),
  }));
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Rank candidates against a query. Uses semantic embeddings when configured,
 * otherwise BM25. Always resolves — embedding failures fall back to BM25.
 * @returns {Promise<{papers: object[], method: 'embeddings'|'lexical'}>}
 */
export async function rankBySimilarity(query, candidates) {
  if (embeddingsEnabled) {
    try {
      const papers = await embeddingRank(query, candidates);
      return { papers, method: "embeddings" };
    } catch (err) {
      console.warn("Embeddings ranking failed, falling back to BM25:", err.message);
    }
  }
  return { papers: bm25Rank(query, candidates), method: "lexical" };
}
