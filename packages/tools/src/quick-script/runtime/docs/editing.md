# Editing files

`files.edit({ edits, dryRun? })` changes workspace files; `artifacts.edit({ name, edits, dryRun? })` takes the same edits for one artifact. Use it for multi-file, pattern or anchor edits; format and test afterwards with bash.

| Edit                                              | Effect                                                             | Must match                      |
| ------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------- |
| `{ oldText, newText }`                            | Replaces the exact text                                            | once                            |
| `{ oldText, newText, all: true, count? }`         | Replaces every occurrence                                          | at least once, or `count` times |
| `{ pattern, replacement, flags?, all?, count? }`  | Regex (`RegExp` or string); `$1`, `$<name>` as in `String.replace` | once; with `all` as above       |
| `{ from, through, newText }`                      | Replaces from `from` through the next `through`                    | `from` once                     |
| `{ from, upTo, newText }`                         | Replaces from `from` up to the next `upTo`, keeping it             | `from` once                     |
| `{ insertBefore, text }`, `{ insertAfter, text }` | Inserts next to the anchor                                         | anchor once                     |

In `files.edit` each edit also names `path` (one file) or `glob` (every file it matches, as in `files.list`; `.gitignore` applies).

- **Order.** A file's edits apply in list order, each to the result of the previous one, so a rename can come before an edit that uses the new name. (The Edit tool instead matches every edit against the original text.)
- **All or nothing.** Every file is read and every edit checked before anything is written. A count mismatch fails the call with the edit's index, the file and the nearest similar line; nothing changes. A `glob` edit skips files without a match, but must match at least once in total (or exactly `count` times).
- **Text.** Line endings and a BOM are kept; binary files are refused. Up to 500 files and {{limit:edit.bytes}} per call.
- **Result.** `files` lists the matched files with each edit's `matches`; `diff` is a unified diff of the changes, cut at {{limit:edit.diff}} with the rest in `diffFile`. Changed workspace files appear in the run's `Updated:` line.
- **Dry run.** `dryRun: true` checks everything and returns the same result without writing.

```ts
const callers = await files.search({ pattern: "fetchUser\\(", glob: "*.ts" });
const result = await files.edit({
  edits: [
    {
      glob: "src/**/*.ts",
      oldText: "fetchUser(",
      newText: "loadUser(",
      all: true,
    },
    // Sees the rename above.
    {
      path: "src/users.ts",
      insertBefore: "export function loadUser(",
      text: "/** Loads one user by id. */\n",
    },
  ],
});
console.log(callers.length, result.diff);
```
