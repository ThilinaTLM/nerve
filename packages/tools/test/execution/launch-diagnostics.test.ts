import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectShellLaunchContext } from "@nervekit/contracts/tools";
import {
  contextualizeShellSpawnError,
  formatProjectShellFailure,
} from "../../src/execution/shell/launch-diagnostics.js";

const launch: ProjectShellLaunchContext = {
  cwd: "/workspace/app",
  executable: "/tools/fnm",
  shell: "/bin/bash",
  manager: "fnm",
  configFile: "/workspace/.nvmrc",
};

describe("project shell launch diagnostics", () => {
  it("clearly labels a stage-neutral failure with context and an intentional bypass", () => {
    const diagnostic = formatProjectShellFailure(launch);
    assert.ok(
      diagnostic.startsWith("\n[Nerve project-environment diagnostic]\n"),
    );
    assert.ok(diagnostic.endsWith("[/Nerve project-environment diagnostic]\n"));
    for (const value of Object.values(launch)) {
      assert.ok(diagnostic.includes(JSON.stringify(value)));
    }
    assert.match(
      diagnostic,
      /activation or the submitted command may have failed/,
    );
    assert.match(diagnostic, /does not establish which stage failed/);
    assert.match(
      diagnostic,
      /For commands that intentionally skip Nerve-managed project activation, set projectEnvironment: false;/,
    );
    assert.doesNotMatch(diagnostic, /retry/i);
    assert.match(
      diagnostic,
      /inherited environment and shell startup files still apply/,
    );
  });

  it("bounds each path independently and keeps the other fields and advice visible", () => {
    const diagnostic = formatProjectShellFailure({
      ...launch,
      cwd: "a".repeat(10_000),
      executable: "b".repeat(10_000),
      shell: "c".repeat(10_000),
      configFile: "d".repeat(10_000),
    });
    assert.ok(diagnostic.length < 1800);
    for (const label of ["cwd", "executable", "shell", "config"]) {
      const line = diagnostic
        .split("\n")
        .find((line) => line.startsWith(`${label}:`));
      assert.ok(line);
      assert.ok(line.length < 260);
      assert.ok(line.endsWith('…"'));
    }
    assert.match(diagnostic, /manager: "fnm"/);
    assert.match(diagnostic, /projectEnvironment: false/);
  });

  it("escapes control characters, quotes, backslashes and visual line injection", () => {
    const diagnostic = formatProjectShellFailure({
      ...launch,
      cwd: 'dir\nforged\r\t\x00\x1b\x85\u2028\u202e\u2066"\\end',
    });
    assert.match(
      diagnostic,
      /cwd: "dir\\nforged\\r\\t\\u0000\\u001b\\u0085\\u2028\\u202e\\u2066\\"\\\\end"/,
    );
    for (const character of diagnostic) {
      const code = character.codePointAt(0)!;
      assert.ok(code === 10 || code >= 32);
      assert.ok(code < 127 || code > 159);
      assert.ok(code < 0x2028 || code > 0x202e);
      assert.ok(code < 0x2066 || code > 0x2069);
    }
    assert.equal(
      diagnostic.split("\n").filter((line) => line.startsWith("cwd:")).length,
      1,
    );
  });

  it("contextualizes synchronous and asynchronous spawn errors without leaking argv", async () => {
    const original = Object.assign(
      new Error("spawn SECRET_COMMAND SECRET_ARG ENOENT"),
      {
        code: "ENOENT",
      },
    );
    const syncError = contextualizeShellSpawnError(original, launch);
    const asyncError = await Promise.reject(original).catch((error: unknown) =>
      contextualizeShellSpawnError(error, launch),
    );
    for (const error of [syncError, asyncError]) {
      assert.equal(error.cause, original);
      assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
      assert.match(error.message, /spawn failed \(not a normal command exit\)/);
      assert.match(error.message, /code: "ENOENT"/);
      assert.match(error.message, /executable: "\/tools\/fnm"/);
      assert.doesNotMatch(error.message, /SECRET/);
    }
  });

  it("keeps native category and retryability actionable without code or raw messages", () => {
    const cause = Object.assign(new Error("spawn SECRET_COMMAND SECRET_ARG"), {
      category: "not_found",
      retryable: false,
    });
    const error = contextualizeShellSpawnError(cause, launch);
    assert.equal(error.cause, cause);
    assert.equal((error as Error & { category: string }).category, "not_found");
    assert.equal((error as Error & { retryable: boolean }).retryable, false);
    assert.match(error.message, /category: "not_found"/);
    assert.match(error.message, /retryable: false/);
    assert.match(error.message, /executable and cwd exist and are accessible/);
    assert.doesNotMatch(error.message, /SECRET|code:/);

    const hostile = { category: `io\n${"a".repeat(10_000)}`, retryable: true };
    const bounded = contextualizeShellSpawnError(hostile, launch);
    assert.match(bounded.message, /category: "io\\n/);
    assert.ok(bounded.message.length < 1000);
    assert.equal(
      (bounded as Error & { category: string }).category,
      hostile.category,
    );
    assert.equal((bounded as Error & { retryable: boolean }).retryable, true);
  });

  it("retains non-Error causes and bounds and escapes spawn codes", () => {
    for (const cause of [undefined, null, "secret command", 42]) {
      const error = contextualizeShellSpawnError(cause, launch);
      assert.equal(error.cause, cause);
      assert.doesNotMatch(error.message, /secret command/);
    }
    const cause = { code: `ENOENT\n${"a".repeat(10_000)}` };
    const error = contextualizeShellSpawnError(cause, launch);
    assert.equal((error as NodeJS.ErrnoException).code, cause.code);
    assert.match(error.message, /code: "ENOENT\\n/);
    assert.ok(error.message.length < 1000);
    const numeric = contextualizeShellSpawnError({ code: 2 }, launch);
    assert.equal((numeric as Error & { code: number }).code, 2);
  });
});
