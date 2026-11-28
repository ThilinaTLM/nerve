import { HOST_ERROR_CODES } from "./errors.js";
import {
  PRINT_ROWS,
  PRINT_STRING_CHARS,
  renderLimits,
  SCRIPT_MAX_SDK_CALLS,
} from "../limits.js";
import type { QuickScriptRegistry } from "../registry.js";

/**
 * The `quick_script` tool description, built from the registry for the
 * namespaces a conversation has configured. It is a cache-stable index: it
 * changes only when that set changes, and never carries method counts or
 * availability (an unusable namespace reports itself through `sdk.list` and at
 * call time). Detail comes on demand from `sdk.*` inside the sandbox.
 */

export type QuickScriptCapabilities = {
  /** Ids of the configured extension namespaces (`jira`, `web`, `diagram`, …) and of built-ins listed only when configured (`mcp`); other built-in capabilities are always present. */
  namespaces?: readonly string[];
};

const INTRO =
  "Run a sandboxed JavaScript script that calls the SDK namespaces below; only its output returns: console.log and the value of the last expression. Use it to loop over, filter and join several calls in one step, and for multi-file or pattern edits (`files.edit`, then format and test with bash); python_exec for general Python, bash for the local machine.\nSandbox: ES module with top-level await; type annotations are ignored; no imports, Node APIs, JSX or direct network and filesystem (use web.*, files.*). Globals: console, sleep(ms), setTimeout/setInterval, URL, URLSearchParams, TextEncoder/TextDecoder, atob/btoa; no fetch, crypto or Intl (toLocale* ignores the locale).";

/** The SDK conventions of docs/architecture/code-mode.md ("Namespace design rules"), as far as a script needs them. */
const CONVENTIONS =
  "Conventions: methods are `namespace.resource.verb()` and take one argument: the ID, key or query alone, or an options object (`<namespace>.request` is raw HTTP and positional). Lists return arrays; a note says when `limit` cut one. A wrong method, option or argument fails with the valid ones.";

const RULES = `Rules: await every call; one still running at the end is stopped (a write may still take effect). Call methods directly, \`files.read(path)\`: an aliased or passed method (\`paths.map(files.read)\`) cannot be scanned and is approved as destructive. The script is approved by its highest-risk call, and each call is checked when it runs: a refused one throws DENIED. Failures throw with e.code (${HOST_ERROR_CODES.join(", ")}); uncaught, one is reported with its code and line, so catch only to continue; a 401 ends the run. Finished calls stay done when a run fails, times out or is cancelled: check the result's Created/Updated/Deleted lines before rerunning. Filter early (queries, \`fields\`, \`limit\`), then in code.`;

const OUTPUT = `Output: text as is, an array of objects as a table, other values as compact JSON. Cut with a note past ${PRINT_STRING_CHARS.toLocaleString("en-US")} characters per string, ${PRINT_ROWS} items or {{limit:print.value}}: print the fields you need.`;

const LIMITS = `Limits per run: ${SCRIPT_MAX_SDK_CALLS} SDK calls, {{limit:script.output}} printed output (the rest is truncated), {{limit:script.memory}} memory. For larger results, \`artifacts.write\` a file: artifacts persist across runs and the result names their folder for Read.`;

const DISCOVER =
  'Result fields cannot be guessed (a wrong name is undefined, not an error): before using them or writing, read `await sdk.describe("<namespace>.<group>")` (or "<namespace>"). Read a listed doc topic, `sdk.docs("<topic>")`, before writing with its namespace or using a library. Find: sdk.search("<words>"), sdk.list().';

const docTopics = (namespace: { docs?: readonly { id: string }[] }) =>
  namespace.docs?.length
    ? `docs: ${namespace.docs.map((topic) => topic.id).join(", ")}`
    : "";

const attributed = (namespace: { attribution?: string }) =>
  namespace.attribution ? ` (${namespace.attribution})` : "";

export function quickScriptDescription(
  { namespaces: configured = [] }: QuickScriptCapabilities = {},
  registry: QuickScriptRegistry,
): string {
  const active = registry.namespaces.filter(
    (namespace) =>
      (namespace.source === "builtin" && !namespace.listedWhenConfigured) ||
      configured.includes(namespace.id),
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
      OUTPUT,
      LIMITS,
      ...listed.flatMap((namespace) =>
        (namespace.rules ?? []).map(
          (rule) => `${namespace.id}${attributed(namespace)}: ${rule}`,
        ),
      ),
      `Namespaces: ${listed.map((namespace) => `${namespace.id} (${[`${namespace.attribution ? `${namespace.attribution}: ` : ""}${namespace.summary}`, docTopics(namespace)].filter(Boolean).join("; ")})`).join("; ")}.`,
      libraries
        ? `Libraries: ${libraries.summary}${docTopics(libraries) ? ` (${docTopics(libraries)})` : ""}.`
        : "",
      DISCOVER,
    ]
      .filter(Boolean)
      .join("\n"),
    registry.limits,
  );
}
