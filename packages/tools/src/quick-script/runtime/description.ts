import { HOST_ERROR_CODES } from "./errors.js";
import { renderLimits } from "../limits.js";
import type { QuickScriptRegistry } from "../registry.js";

/**
 * The `quick_script` tool description, built from the registry for the
 * namespaces a conversation has configured. It is a cache-stable index: it
 * changes only when that set changes, and never carries method counts or
 * availability (an unusable namespace reports itself through `sdk.list` and at
 * call time). Detail comes on demand from `sdk.*` inside the sandbox.
 */

export type QuickScriptCapabilities = {
  /** Ids of the configured extension namespaces (`jira`, `web`, `diagram`, …); built-in capabilities are always present. */
  namespaces?: readonly string[];
};

const INTRO =
  "Run a sandboxed TypeScript script (ES module, top-level await; types are not checked; no Node APIs, imports, JSX, network or filesystem). Globals: console, setTimeout/setInterval, sleep(ms), URL, URLSearchParams, TextEncoder/TextDecoder, atob/btoa; crypto, fetch and Intl do not exist (use web.fetch; toLocale* ignores the locale). One script loops, filters and joins, and only its output returns. Use python_exec for general Python, bash for the local machine.";

/** The SDK conventions of docs/architecture/code-mode.md ("Namespace design rules"), as far as a script needs them. */
const CONVENTIONS =
  "Conventions: methods are `namespace.resource.verb()` (get, list, search, create, update, delete, add, remove, upload, download) and take one argument: the ID, key or query alone, or an options object (exceptions: files.*, request, sdk.search). Lists return arrays, and a footer note says when `limit` cut one. A wrong method, option or argument fails with the valid ones.";

const RULES = `Rules: await every call; calls still running at the end are aborted. Call methods directly, \`files.read(handle)\`: an aliased or passed method (\`handles.map(files.read)\`) cannot be scanned and is approved as destructive. Filter early (JQL/CQL, \`fields\`, \`limit\`), then in code. Failures throw with e.code (${HOST_ERROR_CODES.join(", ")}); a 401 stops the run and finished calls are not undone. The script is approved by its highest-risk call. A returned array of flat objects prints as a table. Artifacts stay available to later scripts.`;

const DISCOVER =
  'Result fields cannot be guessed (a wrong name is undefined, not an error): before using them or writing, read `await sdk.describe("<namespace>.<group>")` (or "<namespace>"). Guides: sdk.docs("<namespace>"). Find: sdk.search("<words>"), sdk.list().';

const attributed = (namespace: { attribution?: string }) =>
  namespace.attribution ? ` (${namespace.attribution})` : "";

export function quickScriptDescription(
  { namespaces: configured = [] }: QuickScriptCapabilities = {},
  registry: QuickScriptRegistry,
): string {
  const active = registry.namespaces.filter(
    (namespace) =>
      namespace.source === "builtin" || configured.includes(namespace.id),
  );
  const listed = active.filter(
    (namespace) => namespace.id !== "sdk" && namespace.id !== "libraries",
  );
  const libraries = active.find((namespace) => namespace.id === "libraries");
  return renderLimits(
    [
      INTRO,
      CONVENTIONS,
      RULES,
      ...listed.flatMap((namespace) =>
        (namespace.rules ?? []).map(
          (rule) => `${namespace.id}${attributed(namespace)}: ${rule}`,
        ),
      ),
      `Namespaces: ${listed.map((namespace) => `${namespace.id} (${namespace.attribution ? `${namespace.attribution}: ` : ""}${namespace.summary})`).join("; ")}.`,
      libraries ? `Libraries: ${libraries.summary}.` : "",
      DISCOVER,
    ]
      .filter(Boolean)
      .join("\n"),
    registry.limits,
  );
}
