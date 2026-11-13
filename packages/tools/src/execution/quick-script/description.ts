import { HOST_ERROR_CODES } from "./errors.js";
import { renderLimits } from "./extensions/limits.js";
import { registeredNamespaces } from "./extensions/registry.js";

/**
 * The `quick_script` tool description, built from the registry for the
 * namespaces a conversation has configured. It is a cache-stable index: it
 * changes only when that set changes, and never carries method counts or
 * availability (an unusable namespace reports itself through `sdk.list` and at
 * call time). Detail comes on demand from `sdk.*` inside the sandbox.
 */

export type QuickScriptCapabilities = {
  /** Ids of the configured extension namespaces (`jira`, `web`, `diagram`, …); runtime namespaces are always present. */
  namespaces?: readonly string[];
};

const INTRO =
  "Run a sandboxed TypeScript script (ES module, top-level await; no Node APIs, imports, JSX, network or filesystem). One script loops, filters and joins, and only its output returns. Use python_exec for general Python, bash for the local machine.";

const RULES = `Rules: methods take one argument, a bare string (key, id, JQL, CQL) or an options object (exceptions: files.*, request, sdk.search); filter early (JQL/CQL, \`fields\`, \`limit\`), then in code; failures throw with e.code (${HOST_ERROR_CODES.join(", ")}), a 401 stops the run and finished calls are not undone; the script is approved by its highest-risk call. Print with console.log or a top-level \`return\`.`;

const DISCOVER =
  'Discover before first use of a namespace: sdk.describe("<namespace>"), sdk.docs("<namespace>"), sdk.search("<words>"), sdk.list().';

export function quickScriptDescription({
  namespaces: configured = [],
}: QuickScriptCapabilities = {}): string {
  const active = registeredNamespaces.filter(
    (namespace) =>
      namespace.source === "runtime" || configured.includes(namespace.id),
  );
  const listed = active.filter(
    (namespace) => namespace.id !== "sdk" && namespace.id !== "libraries",
  );
  const libraries = active.find((namespace) => namespace.id === "libraries");
  return renderLimits(
    [
      INTRO,
      RULES,
      ...listed.flatMap((namespace) =>
        (namespace.rules ?? []).map((rule) => `${namespace.id}: ${rule}`),
      ),
      `Namespaces: ${listed.map((namespace) => `${namespace.id} (${namespace.summary})`).join("; ")}.`,
      libraries ? `Libraries: ${libraries.summary}.` : "",
      DISCOVER,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
