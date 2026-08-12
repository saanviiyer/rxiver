// AI research-assistant chat, grounded in a chat thread's bookmarked items and
// any linked folder. Uses the Anthropic SDK when ANTHROPIC_API_KEY is set;
// otherwise returns a realistic MOCK reply so the app is fully usable with zero
// setup.
import Anthropic from "@anthropic-ai/sdk";

const API_KEY = process.env.ANTHROPIC_API_KEY;
export const MOCK_MODE = !API_KEY;
export const MODEL = "claude-sonnet-5";

const client = MOCK_MODE ? null : new Anthropic({ apiKey: API_KEY });

const SYSTEM_PROMPT = `You are rxiver's research assistant, embedded in a single "chat window" that
belongs to a researcher. A chat window bookmarks papers, ideas, and web tabs, and may be
linked to a folder of saved papers and excerpts. You help the researcher think:
summarize and connect the bookmarked work, surface gaps and next experiments, suggest
what to read next, and answer questions grounded in the provided context.

Rules:
- Ground your answers in the bookmarked items and linked-folder context provided below.
  When you draw on a specific item, refer to it by its title or idea text.
- If the context does not cover something, say so plainly rather than inventing findings,
  citations, authors, or arXiv ids.
- Be concrete and concise. Prefer specific, actionable suggestions over generic advice.`;

// Render the thread's grounding context into a compact text block.
export function buildContext({ threadName, bookmarks = [], folder = null }) {
  const lines = [];
  lines.push(`Chat window: "${threadName || "Untitled"}"`);

  if (bookmarks.length) {
    lines.push("\nBookmarked items:");
    bookmarks.forEach((b, i) => {
      if (b.kind === "paper") {
        lines.push(
          `  ${i + 1}. [paper] ${b.title}${b.arxivId ? ` (arXiv:${b.arxivId})` : ""}${
            b.abstract ? ` — ${b.abstract.slice(0, 400)}` : ""
          }`
        );
      } else if (b.kind === "tab") {
        lines.push(`  ${i + 1}. [tab] ${b.title || b.url}${b.url ? ` <${b.url}>` : ""}`);
      } else {
        lines.push(`  ${i + 1}. [idea] ${b.text || b.title}`);
      }
    });
  } else {
    lines.push("\n(No bookmarks yet.)");
  }

  if (folder) {
    lines.push(`\nLinked folder: "${folder.name}"`);
    for (const p of (folder.papers || []).slice(0, 12)) {
      lines.push(
        `  - [saved paper] ${p.title}${p.arxivId ? ` (arXiv:${p.arxivId})` : ""}`
      );
    }
    for (const e of (folder.excerpts || []).slice(0, 12)) {
      lines.push(
        `  - [excerpt] "${(e.text || "").slice(0, 240)}"${
          e.note ? ` — note: ${e.note}` : ""
        }${e.source ? ` (${e.source})` : ""}`
      );
    }
  }

  return lines.join("\n");
}

// A believable, grounded-looking mock reply built from the actual context.
function mockReply({ threadName, bookmarks = [], folder = null }, messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const q = (lastUser && lastUser.content) || "";
  const paperBms = bookmarks.filter((b) => b.kind === "paper");
  const ideas = bookmarks.filter((b) => b.kind === "idea");
  const tabs = bookmarks.filter((b) => b.kind === "tab");

  const parts = [];
  parts.push(
    `Here's how I'd think about "${threadName || "this thread"}" given what you've bookmarked.`
  );

  if (paperBms.length) {
    parts.push(
      `\nYou've bookmarked ${paperBms.length} paper${
        paperBms.length > 1 ? "s" : ""
      }: ${paperBms
        .slice(0, 3)
        .map((b) => `"${b.title}"`)
        .join(", ")}${paperBms.length > 3 ? ", and more" : ""}. A useful next step is to line up their methods and datasets side by side and look for where their assumptions disagree — that gap is usually where a new contribution lives.`
    );
  }
  if (ideas.length) {
    parts.push(
      `\nOn your idea${ideas.length > 1 ? "s" : ""} (${ideas
        .slice(0, 2)
        .map((b) => `"${b.text || b.title}"`)
        .join(", ")}): try to phrase each as a testable prediction, then note which bookmarked paper most directly supports or challenges it.`
    );
  }
  if (folder) {
    parts.push(
      `\nSince this thread is linked to your "${folder.name}" folder (${
        (folder.papers || []).length
      } papers, ${
        (folder.excerpts || []).length
      } excerpts), I'd revisit those excerpts for a claim you can build the thread's argument around.`
    );
  }
  if (tabs.length) {
    parts.push(`\nYour bookmarked tab${tabs.length > 1 ? "s" : ""} may add context worth pulling in.`);
  }
  if (q) {
    parts.push(
      `\nOn your question — "${q.slice(0, 160)}" — I can only answer from the bookmarked context above; add the relevant papers to this window and I'll ground the answer in them.`
    );
  }
  parts.push(
    `\n(This is a MOCK reply — set ANTHROPIC_API_KEY to get a live, fully grounded response from ${MODEL}.)`
  );
  return parts.join("");
}

/**
 * Generate a chat reply. Resolves to { mockMode, reply }.
 * @param context {threadName, bookmarks, folder}
 * @param messages [{role, content}]
 */
export async function chat(context, messages) {
  if (MOCK_MODE) {
    return { mockMode: true, reply: mockReply(context, messages) };
  }

  const grounding = buildContext(context);
  const convo = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  // Prepend the grounding context to the first user turn so it's always seen.
  const withContext = [
    {
      role: "user",
      content: `Context for this chat window (bookmarks + linked folder):\n\n${grounding}\n\n---\nUse the context above to ground your answers.`,
    },
    { role: "assistant", content: "Understood — I'll ground my answers in that context." },
    ...convo,
  ];

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    thinking: { type: "disabled" },
    messages: withContext,
  });

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { mockMode: false, reply: text || "(No response generated.)" };
}
