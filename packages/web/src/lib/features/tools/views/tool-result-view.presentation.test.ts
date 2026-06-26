import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CWD, metaText, present } from "./tool-result-view.fixtures";

describe("toolPresentation", () => {
  it("puts the file path in the clickable primary arg for read", () => {
    const p = present(
      "read",
      { path: "src/app.ts" },
      { path: `${CWD}/src/app.ts`, content: "a\nb\nc" },
    );
    assert.equal(p.badge, "read");
    assert.equal(p.primaryArg?.text, "src/app.ts");
    assert.equal(p.primaryArg?.openPath, `${CWD}/src/app.ts`);
    assert.deepEqual(metaText(p.meta), ["3 lines"]);
  });

  it("marks a non-zero bash exit with an error chip and no collapse for short output", () => {
    const p = present(
      "bash",
      { command: "make build" },
      { content: "line1\nline2", exitCode: 2, details: { signal: null } },
    );
    assert.equal(p.primaryArg?.text, "make build");
    assert.equal(p.primaryArg?.openPath, undefined);
    assert.ok(p.meta.some((m) => m.text === "exit 2" && m.tone === "error"));
    assert.equal(p.collapse, undefined);
  });

  it("preserves whitespace for multi-line bash command primary args", () => {
    const command = "printf 'a' &&\n  printf 'b'";
    const p = present("bash", { command }, { content: "ok", exitCode: 0 });
    assert.equal(p.primaryArg?.text, command);
    assert.equal(p.primaryArg?.preserveWhitespace, true);
  });

  it("computes a tail collapse for long bash output", () => {
    const output = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
    const p = present(
      "bash",
      { command: "x" },
      { content: output, exitCode: 0 },
    );
    assert.ok(p.collapse);
    assert.equal(p.collapse?.hidden, 15);
    assert.match(p.collapse?.expandLabel ?? "", /earlier lines/);
  });

  it("marks python exits and planning write guard metadata with an inline source marker", () => {
    const p = present(
      "python",
      { code: "print('x')\nprint('y')" },
      {
        content: "x\ny",
        exitCode: 3,
        details: { allowFileWrite: false, signal: null },
      },
    );
    assert.equal(p.primaryArg?.text, "inline");
    assert.ok(p.meta.some((m) => m.text === "exit 3" && m.tone === "error"));
    assert.ok(p.meta.some((m) => m.text === "2 code lines"));
    assert.ok(p.meta.some((m) => m.text === "2 lines"));
    assert.ok(
      p.meta.some((m) => m.text === "writes off" && m.tone === "warning"),
    );
    assert.equal(p.dotTone, "danger");
  });

  it("uses the script path as python primary arg for file mode", () => {
    const p = present(
      "python",
      { path: "scripts/report.py" },
      {
        content: "ok",
        exitCode: 0,
        details: { inputMode: "file", scriptPath: `${CWD}/scripts/report.py` },
      },
    );
    assert.equal(p.primaryArg?.text, "scripts/report.py");
    assert.equal(p.primaryArg?.openPath, `${CWD}/scripts/report.py`);
    assert.ok(!p.meta.some((m) => m.text.includes("code line")));
  });

  it("produces a collapse toggle when the python script alone exceeds the limit", () => {
    const code = Array.from({ length: 14 }, (_, i) => `line${i}`).join("\n");
    const p = present("python", { code }, { content: "ok" });
    assert.ok(p.collapse);
    assert.equal(p.collapse?.hidden, 4);
    assert.match(p.collapse?.expandLabel ?? "", /Show 4 more lines/);
  });

  it("emits byte, line, and char chips for writes", () => {
    const p = present(
      "write",
      { path: "out.txt", content: "hello\nworld" },
      { path: `${CWD}/out.txt`, content: "Wrote 11 bytes." },
    );

    assert.deepEqual(metaText(p.meta), [
      "wrote 11 bytes",
      "2 lines",
      "11 chars",
    ]);
  });

  it("emits +/- chips for edit diffs", () => {
    const p = present(
      "edit",
      { path: "x.ts", replacements: [{ oldText: "a", newText: "b" }] },
      {
        path: `${CWD}/x.ts`,
        details: {
          diff: "@@ -1 +1 @@\n-a\n+b",
          lineEnding: "\n",
          bom: false,
          dryRun: false,
          operationCount: 1,
          operations: [{ index: 0, type: "replace_text", matchedBy: "unique" }],
        },
      },
    );
    assert.ok(p.meta.some((m) => m.text === "1 operation"));
    assert.ok(p.meta.some((m) => m.text === "+1" && m.tone === "success"));
    assert.ok(p.meta.some((m) => m.text === "−1" && m.tone === "error"));
  });

  it("emits operation and preview chips for edit dry runs", () => {
    const p = present(
      "edit",
      {
        path: "x.ts",
        replacements: [{ oldText: "a", newText: "b" }],
      },
      {
        path: `${CWD}/x.ts`,
        details: {
          diff: "@@ -1 +1 @@\n-a\n+b",
          lineEnding: "\n",
          bom: false,
          dryRun: true,
          operationCount: 1,
          operations: [{ index: 0, type: "replace_text", matchedBy: "unique" }],
        },
      },
    );
    assert.ok(p.meta.some((m) => m.text === "1 operation"));
    assert.ok(p.meta.some((m) => m.text === "preview" && m.tone === "info"));
    assert.ok(p.meta.some((m) => m.text === "+1" && m.tone === "success"));
    assert.ok(p.meta.some((m) => m.text === "−1" && m.tone === "error"));
  });

  it("marks errored edit calls with danger status", () => {
    const p = present(
      "edit",
      {
        path: "x.ts",
        replacements: [{ oldText: "a", newText: "b", note: "bad" }],
      },
      undefined,
      { status: "error", error: "Validation failed." },
    );
    assert.equal(p.dotTone, "danger");
    assert.equal(p.primaryArg?.text, "x.ts");
  });

  it("uses the url as an href primary arg for web_fetch", () => {
    const p = present(
      "web_fetch",
      { url: "https://example.test" },
      {
        content: "# Example",
        details: {
          url: "https://example.test",
          status: 200,
          contentType: "text/html",
          size: 9,
          converted: true,
        },
      },
    );
    assert.equal(p.primaryArg?.href, "https://example.test");
    assert.ok(p.meta.some((m) => m.text === "200" && m.tone === "success"));
    assert.ok(p.meta.some((m) => m.text === "markdown" && m.tone === "info"));
  });

  it("shows no footer chip for an answered ask_user with no primary arg", () => {
    const p = present(
      "ask_user",
      { question: "Which?" },
      { question: "Which?", response: "B" },
    );
    assert.equal(p.primaryArg, undefined);
    assert.deepEqual(metaText(p.meta), []);
  });

  it("shows no footer chip for a dismissed ask_user", () => {
    const p = present(
      "ask_user",
      { question: "Which?" },
      { question: "Which?", dismissed: true, dismissedReason: "aborted" },
    );
    assert.equal(p.primaryArg, undefined);
    assert.deepEqual(metaText(p.meta), []);
  });

  it("shows no footer chip for a rejected plan_mode_present", () => {
    const p = present(
      "plan_mode_present",
      { file_path: "/home/user/.nerve/plans/feature.md" },
      {
        review: {
          planPath: "/home/user/.nerve/plans/feature.md",
          status: "changes_requested",
        },
        outcome: "changes_requested",
      },
    );
    assert.equal(p.badge, "plan_mode_present");
    assert.equal(p.primaryArg?.text, "/home/user/.nerve/plans/feature.md");
    assert.deepEqual(metaText(p.meta), []);
  });

  it("labels the badge as todos and reports progress", () => {
    const p = present(
      "todos_set",
      { todos: [] },
      {
        details: {
          todos: [
            { todo: "a", done: true },
            { todo: "b", done: false },
          ],
        },
      },
    );
    assert.equal(p.badge, "todos");
    assert.deepEqual(metaText(p.meta), ["1/2 done"]);
  });
});
