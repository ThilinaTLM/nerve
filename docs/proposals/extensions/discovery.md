# Discovery and the tool description

Part of [Extensions](README.md).

## `sdk` in the sandbox

`sdk` is part of the runtime, not an extension. Its methods have risk `none`, so scripts that only call it classify as read and run without approval under every built-in rule set.

| Call                                     | Returns                                                                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sdk.list()`                             | Every namespace with `source`, `available`, `summary`, `reason`/`fix` when unavailable, method count and doc topics. Libraries are listed too.                   |
| `sdk.describe("jira")`                   | The namespace's `.d.ts`: types plus method declarations with one-line docs and `Destructive.` tags.                                                              |
| `sdk.describe("jira.issues")`            | Only that group.                                                                                                                                                 |
| `sdk.describe("jira.issues.create")`     | One declaration plus the types it references.                                                                                                                    |
| `sdk.search("sprint", { in?, offset? })` | Methods whose path, doc line or parameter names match, across available namespaces or within `in` (`"mcp.github"`). One line each: path, signature, risk. Paged. |
| `sdk.docs("jira")`                       | The topic index with when-to-read lines.                                                                                                                         |
| `sdk.docs("jira/workflows")`             | One topic's Markdown.                                                                                                                                            |

- **Output is plain text** shaped for the model (a declaration block or Markdown).
- **Unavailable namespaces show in `list` but not in `describe` or `search`.** `describe` on one returns its reason and fix. A namespace the user disabled is listed as unavailable too, so the agent can tell the user how to enable it instead of guessing.
- **A typical flow takes two calls:** one discovery script (`sdk.describe("jira.issues"); sdk.docs("jira/workflows")`), then the working script. Simple tasks covered by the description skip discovery.
- **Errors point back here.** A call with wrong arguments includes that method's declaration line, so the agent can fix the call without a separate `describe`.

## Large namespaces

A large MCP server can declare hundreds of methods and more than 100 KB of types, so discovery output must fit the [result projection](../../architecture/tool-result-projection.md). `quick_script` output uses the `script_output` profile ([`profiles.ts`](../../../packages/tools/src/result-projection/profiles.ts)): 24 KB or 600 lines inline, and above that a head/tail excerpt that favours the tail. For a declaration dump, that excerpt is the worst cut, because the agent loses methods without knowing which ones. Discovery therefore bounds itself and never relies on projection:

1. **Per-run discovery budget.** `sdk.*` calls in one run share a text budget set well below the inline budget (about 12 KB), so the agent's own prints still fit.
2. **Summary first.** When `describe` would exceed the remaining budget, it returns a summary instead: groups with method counts, and one line per method (name and doc line) for as many methods as fit. It ends with how to narrow the request (`sdk.describe("mcp.github.issues")`, `sdk.search("…", { in: "mcp.github" })`).
3. **Full text in a file.** The summary also writes the complete declarations to an artifact (`sdk-mcp.github.d.ts`) and prints its path. The agent pages through it with `read` offsets or searches it with `grep`, both of which already have exact continuation. Writing the file has no external effect and needs no approval.
4. **`search` is the main tool for large namespaces.** Results are one line per method, ranked by path match over doc match, and paged with `offset`. Every page ends with `next: sdk.search("…", { offset: 40 })` while matches remain.

The same budget and spill behaviour applies to `sdk.docs` for long topics.

## Tool description

The description is a cache-stable index:

```text
Run a sandboxed TypeScript script (ES module, top-level await; no Node APIs, imports, JSX, network or filesystem). One script loops, filters and joins; only its output returns. Use python_exec for general Python, bash for the local machine.
Rules: one argument per method (bare id string or options object); failures throw with e.code; the script is approved by its highest-risk call; write to integrations only on explicit user request. Print with console.log or a top-level return.
Namespaces: files, image, diagram (Kroki), imagegen, jira (bounded JQL), confluence (Markdown or storage.* bodies), web (fetch, search), mcp.github, …
Libraries: XLSX, Papa, docx, mammoth, PptxGenJS, pptxText, JSZip.
Discover before first use of a namespace: sdk.describe("jira.issues"), sdk.docs("jira"), sdk.search("…"), sdk.list().
```

- The content of today's `SKILL.md` "Rules" section moves into the description, so no separate entry document is needed.
- **Volatility:** the description changes only when the set of configured namespaces changes. It never includes method counts, MCP tool names or connection state. An MCP server that is configured but not yet connected still appears, and its namespace reports `unavailable` at call time. This keeps the prompt prefix stable across reconnects.
- Each namespace contributes at most its `summary` and `rules`, and a test caps each contribution's length.
- The write restriction stays in the description ([tool-writing rules](../../architecture/system-prompt.md#tool-writing-rules)).
