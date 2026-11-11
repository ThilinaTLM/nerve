/**
 * The `quick_script` tool description, built per conversation from the active
 * capabilities. Fragments appear in registry order and only when active, so the
 * text changes only when settings change (the prompt cache holds).
 *
 * To add a namespace or library: add an entry below with `landed: true` once
 * its SDK or bundle ships, and have the caller pass its id in `QuickScriptCapabilities`.
 */

type Fragment = {
  id: string;
  /** What the model reads in the `Integrations:` / `Utilities:` line. */
  text: string;
  /** False until the namespace or library ships; requested-but-unlanded entries are ignored. */
  landed: boolean;
};

/** Namespaces backed by an account; each is listed only when enabled and configured. */
const INTEGRATIONS: readonly Fragment[] = [
  {
    id: "jira",
    text: "jira (bounded JQL, e.g. `project = X`)",
    landed: true,
  },
  {
    id: "confluence",
    text: "confluence (page bodies are storage XHTML; `storage` builds it)",
    landed: true,
  },
  { id: "web", text: "web (fetch, search)", landed: false },
];

/** Globals that need no account. `always` entries are present in every script. */
const UTILITIES: readonly (Fragment & { always: boolean })[] = [
  { id: "files", text: "files", landed: true, always: true },
  { id: "XLSX", text: "XLSX", landed: true, always: true },
  { id: "Papa", text: "Papa", landed: true, always: true },
  { id: "docx", text: "docx", landed: false, always: false },
  { id: "pptx", text: "pptx", landed: false, always: false },
  { id: "image", text: "image", landed: true, always: true },
  { id: "diagram", text: "diagram (Kroki)", landed: true, always: true },
];

export type QuickScriptCapabilities = {
  /** Integration ids that are enabled and have an account (`jira`, `confluence`, `web`). */
  integrations?: readonly string[];
  /** Optional library ids to list (`docx`, `pptx`). */
  libraries?: readonly string[];
};

export function quickScriptDescription(
  capabilities: QuickScriptCapabilities = {},
): string {
  const integrations = INTEGRATIONS.filter(
    (entry) => entry.landed && capabilities.integrations?.includes(entry.id),
  ).map((entry) => entry.text);
  const utilities = UTILITIES.filter(
    (entry) =>
      entry.landed &&
      (entry.always || capabilities.libraries?.includes(entry.id)),
  ).map((entry) => entry.text);
  const scope = integrations.length
    ? "integration work and document/data tasks"
    : "document/data tasks";
  return [
    `Run a sandboxed TypeScript script: no Node APIs, imports, JSX, network or filesystem; only the globals below. Use it for ${scope}, especially multi-step ones — one script loops, filters and joins, and only its output returns. Use python_exec for general Python, bash for the local machine.`,
    integrations.length ? `Integrations: ${integrations.join(", ")}.` : "",
    `Utilities: ${utilities.join(", ")}.`,
    `Print with console.log or a top-level \`return\`.${integrations.length ? " Write to integrations only on explicit user request." : ""} Read {{skill:quick-script}} before first use.`,
  ]
    .filter(Boolean)
    .join("\n");
}
