# Permission matchers

What a rule's `when` can match. Rule, rule set and overlay files: `reference/permissions.md`.

## Filter (`when`)

All present fields must match.

| Field             | Matches                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toolNames`       | The tool name is one of these (1–256).                                                                                                                |
| `toolKinds`       | Tool kind: `filesystem`, `command`, `code`, `external_read`, `interaction`, `orchestration`, `deployment`, `integration`, `other`.                    |
| `toolGroups`      | Tool group (any of these). An extension's tool and its SDK operations carry both the extension id and the namespace (`web-search` and `search`).      |
| `baseRisks`       | Risk of the call: `read`, `write`, `external_read`, `external_write`, `secret`, `destructive`, `deployment`, `agent_spawn`, `interaction`, `unknown`. |
| `primaryArgument` | Value matcher on the tool's primary argument (table below).                                                                                           |
| `primaryTarget`   | Target matcher on the call's first target.                                                                                                            |
| `targets`         | `{ "quantifier": <"any" or "all">, "matcher": <target matcher> }` over all targets of the call.                                                       |
| `arguments`       | 1–64 value matchers on named arguments, each with `"path": "args.<name>(.<name>)*"`.                                                                  |

Value matcher: `{ "operator": "equals" | "not_equals", "value": <string|number|boolean|array> }`, `{ "operator": "in", "value": [<primitives>] }`, `{ "operator": "glob", "value": "<pattern>" }`, `{ "operator": "exists", "value": true|false }`.

Target matcher: any of `kind` (`path`, `url`, `agent`, `resource`, `whole_tool`), `access` (`read`, `write`), `scope` (`exact`, `tree`; paths only), `root` (`project`, `nerve_home`, `nerve_data`, `plans`; paths only), `pattern` (glob over the path relative to its root, the full URL, the agent id or the resource value). Path patterns are relative POSIX paths: no leading `/`, no `..`, no backslashes.

### Globs

Patterns use POSIX path globbing on the whole value: `*` matches within one `/`-separated segment, `**` matches whole segments, `{a,b}` alternates, `?` one character.

- `src/**` matches everything under `src`; `src/*` only direct children.
- `https://api.github.com/**` matches every URL on that host path.
- For commands, the whole command line is one value, so `pnpm test*` also matches `pnpm test && rm -rf build`. Prefer `equals` or `in` with exact commands. Use a glob only when its wildcard cannot reach a second command, and remember `*` stops at `/`.

### Working directory

A `bash` rule on the command line ignores the folder it runs in: `equals "npm test"` also allows `npm test` with `cwd` set to any folder of the project, which matters in a repository with several packages. To pin the folder, add an `arguments` matcher on `args.cwd`:

- Project root only: `{ "path": "args.cwd", "operator": "exists", "value": false }`.
- One folder: `{ "path": "args.cwd", "operator": "equals", "value": "packages/web" }`.

`args.cwd` is compared as the agent wrote it, so another spelling of the same folder (`./packages/web`, an absolute path) does not match and gets the rule set's normal decision, usually a prompt.

### What each tool exposes

`configuration.tools.list()` returns every tool with its exact `name`, `kind`, `groups`, `baseRisk`, `primaryArguments` (the first present one is what `primaryArgument` matches) and `targetKinds`. Notes it cannot show:

- `quick_script` is checked as a whole script, and again once per SDK operation it performs. An operation's primary argument is its name (`jira.issues.create`), its target a resource (`jira:issue/APP-12`), its group the namespace and the extension id.
- `launch`: the primary argument is `[action, name]` (an array) when a name is given, else `action`; match the name with `arguments` on `args.name`.
- `find`, `ls` and `grep` target a path as a tree; `read`, `edit` and `write` an exact path.

Paths are resolved to the most specific root: `project` (the project directory), `plans`, `nerve_data`, `nerve_home`. A path outside all roots has no root and matches only matchers without `root` and `pattern`.

`bash` always has risk `unknown` in rules, so `baseRisks: ["read"]` never matches a shell command; match shell commands by `toolNames` plus `primaryArgument`. A quick_script SDK call is checked once per operation it performs; its risk is `read`, `external_read`, `external_write` or `destructive` by method. An extension's direct tool (`web_search`) is admitted by its tool name, and the operation it runs is checked again as a quick_script operation (`search.web`). A group rule (`toolGroups: ["search"]` or `["web-search"]`) covers both routes; `toolNames` names only the tool. Prefer a risk rule, then a group rule for one extension or namespace; use a tool or operation name only for a single call.

### Allow rules and targets

An `allow` rule with `targets.quantifier: "all"` covers a call only when the call has targets, and every target matches. Use `"all"` for allow rules over paths or URLs so a call touching one allowed and one other file is not allowed.
