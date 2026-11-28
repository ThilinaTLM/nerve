# Editing files

`files.edit` changes workspace files; `artifacts.edit({ name, edits, dryRun? })` takes the same edits for one artifact. Format and test afterwards with bash.

```js
files.edit({
  glob: "src/**/*.ts", // or path; an edit may name its own
  edits: [
    { pattern: /\bfetchUser\b/g, replacement: "loadUser", count: 6 },
    { oldText: "console.log(", newText: "logger.debug(", all: true },
    {
      path: "src/config.ts",
      from: "// legacy start",
      through: "// legacy end\n",
    },
  ],
});
```

| Edit                                              | Effect                                                 | Must match                      |
| ------------------------------------------------- | ------------------------------------------------------ | ------------------------------- |
| `{ oldText, newText }`                            | Replaces the exact text                                | once                            |
| `{ oldText, newText, all: true, count? }`         | Replaces every occurrence                              | at least once, or `count` times |
| `{ pattern, replacement, count? }`                | Regex; `$1`, `$<name>` as in `String.replace`          | once; with a `g` flag as above  |
| `{ from, through, newText? }`                     | Replaces from `from` through the next `through`        | `from` once                     |
| `{ from, upTo, newText? }`                        | Replaces from `from` up to the next `upTo`, keeping it | `from` once                     |
| `{ insertBefore, text }`, `{ insertAfter, text }` | Inserts next to the anchor                             | anchor once                     |

- **Order.** A file's edits apply in list order, each to the result of the previous one. (The Edit tool matches every edit against the original text.)
- **All or nothing.** Every edit is checked before anything is written; a mismatch fails the call with the edit's index and file, and nothing changes. A `glob` edit skips files without a match but must match at least once in total (or `count` times).
- **Range edits** delete the range when `newText` is omitted.
- **Result.** It prints as one line per file, for the first 20 files: lines added and removed, and each edit's matches (`src/api.ts +3 -3: [0] 2, [1] 1`). `result.files` has all of them. `result.diff` is the unified diff, cut at {{limit:edit.diff}} with the rest in `diffFile`. The run's result also states each edit's total matches.
- **Dry run.** `dryRun: true` checks everything and returns the same result without writing.
- **Limits.** 500 files and {{limit:edit.bytes}} per call; binary files are refused; line endings and a BOM are kept.

For logic the edits cannot express, `transform` maps each file's text to its new text, with the same all-or-nothing write. Return `undefined` to leave a file unchanged.

```js
files.edit({
  glob: "src/**/*.ts",
  transform: (text, path) =>
    text.replace(/TODO\((\w+)\)/g, (_, who) => `TODO(@${who.toLowerCase()})`),
});
```
