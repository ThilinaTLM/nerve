/**
 * The `quick_script` tool description, built per conversation from the active
 * integrations. Fragments appear in a fixed order and only when active, so the
 * text changes only when settings change (the prompt cache holds).
 */

/** Namespaces backed by an account, in display order. */
const INTEGRATIONS = [
  { id: "jira", text: "jira (bounded JQL, e.g. `project = X`)" },
  {
    id: "confluence",
    text: "confluence (page bodies are storage XHTML; `storage` builds it)",
  },
  { id: "web", text: "web (fetch)" },
] as const;

/** Passed alongside `web` when a Tavily account is selected. */
const WEB_SEARCH_ID = "web.search";

/** Globals present in every script. */
const UTILITIES =
  "files, XLSX, Papa, docx + mammoth (Word), PptxGenJS + pptxText (PowerPoint), image, diagram (Kroki)";

/** Integrations that can write: their presence adds the explicit-request rule. */
const WRITABLE = new Set(["jira", "confluence"]);

export type QuickScriptCapabilities = {
  /** Active integration ids (`jira`, `confluence`, `web`), plus `web.search` when a Tavily account is selected. */
  integrations?: readonly string[];
};

export function quickScriptDescription({
  integrations: active = [],
}: QuickScriptCapabilities = {}): string {
  const integrations = INTEGRATIONS.filter((entry) =>
    active.includes(entry.id),
  ).map((entry) =>
    entry.id === "web" && active.includes(WEB_SEARCH_ID)
      ? "web (fetch, search)"
      : entry.text,
  );
  const writes = active.some((id) => WRITABLE.has(id));
  const scope = integrations.length
    ? "integration work and document/data tasks"
    : "document/data tasks";
  return [
    `Run a sandboxed TypeScript script: no Node APIs, imports, JSX, network or filesystem; only the globals below. Use it for ${scope}, especially multi-step ones — one script loops, filters and joins, and only its output returns. Use python_exec for general Python, bash for the local machine.`,
    integrations.length ? `Integrations: ${integrations.join(", ")}.` : "",
    `Utilities: ${UTILITIES}.`,
    `Print with console.log or a top-level \`return\`.${writes ? " Write to integrations only on explicit user request." : ""} Read {{skill:quick-script}} before first use.`,
  ]
    .filter(Boolean)
    .join("\n");
}
