import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseToolView } from "./tool-result-view";
import { CWD, toolCall } from "./tool-result-view.fixtures";

describe("parseToolView grep/find/ls", () => {
  it("groups grep matches by file and counts them", () => {
    const view = parseToolView(
      toolCall(
        "grep",
        { pattern: "TODO" },
        {
          matches: [
            { path: "a.ts", line: 1, text: "// TODO one" },
            { path: "a.ts", line: 9, text: "// TODO two" },
            { path: "b.ts", line: 3, text: "// TODO three" },
          ],
        },
      ),
    );
    assert.equal(view.kind, "grep");
    if (view.kind !== "grep") return;
    assert.equal(view.matchCount, 3);
    assert.equal(view.fileCount, 2);
    assert.equal(view.allMatches[0]?.path, "a.ts");
    assert.equal(view.allMatches[0]?.matches.length, 2);
  });

  it("preserves duplicate grep rows for the UI to render safely", () => {
    const duplicate = { path: "a.ts", line: 7, text: "const value = TODO;" };
    const view = parseToolView(
      toolCall(
        "grep",
        { pattern: "TODO" },
        { matches: [duplicate, duplicate] },
      ),
    );

    assert.equal(view.kind, "grep");
    if (view.kind !== "grep") return;
    assert.equal(view.matchCount, 2);
    assert.equal(view.fileCount, 1);
    assert.equal(view.allMatches[0]?.matches.length, 2);
    assert.deepEqual(
      view.allMatches[0]?.matches.map(({ path, line, text }) => ({
        path,
        line,
        text,
      })),
      [duplicate, duplicate],
    );
  });

  it("resolves grep match links against a Windows search root", () => {
    const view = parseToolView(
      toolCall(
        "grep",
        { path: "src", pattern: "setActiveComposerText" },
        {
          path: "C:\\Users\\me\\repo\\src",
          matches: [
            { path: "App.svelte", line: 163, text: "void openFilePane();" },
          ],
        },
        { cwd: "C:\\Users\\me\\repo" },
      ),
    );

    assert.equal(view.kind, "grep");
    if (view.kind !== "grep") return;
    assert.equal(
      view.allMatches[0]?.openPath,
      "C:\\Users\\me\\repo\\src\\App.svelte",
    );
    assert.equal(
      view.allMatches[0]?.matches[0]?.openPath,
      "C:\\Users\\me\\repo\\src\\App.svelte",
    );
  });

  it("resolves grep match links against the search root", () => {
    const view = parseToolView(
      toolCall(
        "grep",
        { path: "packages/web/src", pattern: "setActiveComposerText" },
        {
          path: `${CWD}/packages/web/src`,
          matches: [
            { path: "App.svelte", line: 163, text: "void openFilePane();" },
          ],
        },
      ),
    );

    assert.equal(view.kind, "grep");
    if (view.kind !== "grep") return;
    assert.equal(view.allMatches[0]?.path, "App.svelte");
    assert.equal(
      view.allMatches[0]?.openPath,
      `${CWD}/packages/web/src/App.svelte`,
    );
    assert.equal(
      view.allMatches[0]?.matches[0]?.openPath,
      `${CWD}/packages/web/src/App.svelte`,
    );
  });

  it("truncates long grep match lines", () => {
    const longLine = `prefix ${"x".repeat(1_000)} suffix`;
    const view = parseToolView(
      toolCall(
        "grep",
        { pattern: "prefix" },
        { matches: [{ path: "dist/app.css", line: 1, text: longLine }] },
      ),
    );

    assert.equal(view.kind, "grep");
    if (view.kind !== "grep") return;
    const text = view.allMatches[0]?.matches[0]?.text ?? "";
    assert.ok(text.length <= 260);
    assert.match(text, /chars omitted/);
  });

  it("parses find paths", () => {
    const view = parseToolView(
      toolCall(
        "find",
        { pattern: "*.ts" },
        {
          entries: [
            { path: "a.ts", kind: "file" },
            { path: "b.ts", kind: "file" },
          ],
        },
      ),
    );
    assert.equal(view.kind === "find" && view.count, 2);
  });

  it("resolves find result links against a Windows search root", () => {
    const view = parseToolView(
      toolCall(
        "find",
        { path: "src", pattern: "*.svelte" },
        {
          path: "C:\\Users\\me\\repo\\src",
          entries: [{ path: "App.svelte", kind: "file" }],
        },
        { cwd: "C:\\Users\\me\\repo" },
      ),
    );

    assert.equal(view.kind, "find");
    if (view.kind !== "find") return;
    assert.equal(view.openPaths[0], "C:\\Users\\me\\repo\\src\\App.svelte");
  });

  it("resolves find result links against the search root", () => {
    const view = parseToolView(
      toolCall(
        "find",
        { path: "packages/web/src", pattern: "*.svelte" },
        {
          path: `${CWD}/packages/web/src`,
          entries: [{ path: "App.svelte", kind: "file" }],
        },
      ),
    );

    assert.equal(view.kind, "find");
    if (view.kind !== "find") return;
    assert.equal(view.paths[0], "App.svelte");
    assert.equal(view.openPaths[0], `${CWD}/packages/web/src/App.svelte`);
  });

  it("parses ls entries", () => {
    const view = parseToolView(
      toolCall(
        "ls",
        { path: "." },
        {
          path: CWD,
          entries: [
            { path: "src/", kind: "directory" },
            { path: "readme.md", kind: "file" },
          ],
        },
      ),
    );
    assert.equal(view.kind, "ls");
    if (view.kind !== "ls") return;
    assert.equal(view.total, 2);
    assert.equal(view.relPath, ".");
  });
});
