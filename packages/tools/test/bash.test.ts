import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { executeBash } from "../src/execution/index.js";
import { createTempProject, writeExecutable } from "./helpers.js";

const node = JSON.stringify(process.execPath);

describe("bash executor", () => {
  it("rejects empty commands", async () => {
    await assert.rejects(
      executeBash({ command: "   " }, { cwd: process.cwd() }),
      /command.*non-empty string/,
    );
  });

  async function waitForFile(path: string): Promise<string> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const value = await readFile(path, "utf8").catch(() => undefined);
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${path}`);
  }

  async function waitForProcessExit(pid: number): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Process ${pid} survived abort`);
  }

  it("uses non-interactive pager-safe environment defaults", async () => {
    const project = await createTempProject();
    const result = await executeBash(
      {
        command: `${node} -e "process.stdout.write(JSON.stringify({ PAGER: process.env.PAGER, GIT_PAGER: process.env.GIT_PAGER, GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT, TERM: process.env.TERM }))"`,
      },
      { cwd: project.root },
    );
    const env = JSON.parse(result.stdout ?? "{}") as Record<string, string>;

    assert.equal(env.PAGER, "cat");
    assert.equal(env.GIT_PAGER, "cat");
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.TERM, "dumb");
  });

  it("does not manufacture a CI environment", async () => {
    const inheritedCi = process.env.CI;
    delete process.env.CI;
    try {
      const project = await createTempProject();
      const result = await executeBash(
        {
          command: `${node} -e "process.stdout.write(process.env.CI ?? 'unset')"`,
        },
        { cwd: project.root },
      );

      assert.equal(result.stdout, "unset");
    } finally {
      if (inheritedCi === undefined) delete process.env.CI;
      else process.env.CI = inheritedCi;
    }
  });

  it("uses configured shellPath instead of the platform default shell", async (t) => {
    if (process.platform === "win32") {
      t.skip("Executable fixture scripts use POSIX shebangs.");
      return;
    }
    const project = await createTempProject();
    const shellPath = await writeExecutable(
      project.root,
      "fake-shell",
      "process.stdout.write('custom shell:' + process.argv.slice(2).join('|'))",
    );
    const result = await executeBash(
      { command: "echo from-command" },
      { cwd: project.root, shellPath },
    );

    assert.equal(result.stdout, "custom shell:-c|echo from-command");
    assert.equal(result.exitCode, 0);
  });

  it("returns stdout, stderr, and exitCode for successful commands", async () => {
    const project = await createTempProject();
    const result = await executeBash(
      {
        command: `${node} -e "process.stdout.write('out'); process.stderr.write('err')"`,
      },
      { cwd: project.root },
    );

    assert.equal(result.stdout, "out");
    assert.equal(result.stderr, "err");
    assert.equal(result.exitCode, 0);
    const details = result.details as {
      fullOutputPath?: string;
      streams?: { combined?: { truncated?: boolean } };
    };
    assert.equal(details.fullOutputPath, undefined);
    assert.equal(details.streams?.combined?.truncated, false);
  });

  it("saves large output to one transcript and returns first/last previews", async () => {
    const project = await createTempProject();
    const result = await executeBash(
      {
        command: `${node} -e "for (let i = 0; i < 600; i++) console.log('line ' + i)"`,
      },
      { cwd: project.root, dataDir: project.root },
    );

    assert.match(result.content ?? "", /output exceeded inline limits/);
    assert.match(result.content ?? "", /Preview — first 40 lines/);
    assert.match(result.content ?? "", /line 0/);
    assert.match(result.content ?? "", /Preview — last 40 lines/);
    assert.match(result.content ?? "", /line 599/);
    assert.match(result.content ?? "", /Use read with offset\/limit or grep/);

    const details = result.details as {
      fullOutputPath?: string;
      truncation?: { truncated?: boolean; direction?: string };
      streams?: {
        stdout?: { truncated?: boolean; savedTo?: string };
        stderr?: { truncated?: boolean; savedTo?: string };
        combined?: { truncated?: boolean; savedTo?: string };
      };
    };
    assert.ok(details.fullOutputPath);
    assert.match(
      details.fullOutputPath,
      /tmp[\\/]tool-outputs[\\/]nerve-bash-/,
    );
    assert.equal(details.truncation?.truncated, true);
    assert.equal(details.truncation?.direction, "head_tail");
    assert.equal(details.streams?.stdout?.truncated, true);
    assert.equal(details.streams?.stdout?.savedTo, undefined);
    assert.equal(details.streams?.stderr?.savedTo, undefined);
    assert.equal(details.streams?.combined?.truncated, true);
    assert.equal(details.streams?.combined?.savedTo, details.fullOutputPath);

    const transcript = await readFile(details.fullOutputPath, "utf8");
    assert.match(transcript, /line 0/);
    assert.match(transcript, /line 599/);
  });

  it("returns captured output as a structured result on timeout", async () => {
    const project = await createTempProject();
    const result = await executeBash(
      {
        command: `${node} -e "process.stdout.write('partial'); setInterval(() => {}, 1000)"`,
        timeout: 1,
      },
      { cwd: project.root },
    );

    assert.equal(result.stdout, "partial");
    assert.equal(result.exitCode, 124);
    assert.match(result.content ?? "", /timed out/);
    const details = result.details as { timedOut?: boolean };
    assert.equal(details.timedOut, true);
  });

  it("force-kills the process tree when execution is aborted", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX process-group assertion");
      return;
    }
    const project = await createTempProject();
    const pidPath = join(project.root, "abort.pid");
    const abort = new AbortController();
    const execution = executeBash(
      {
        command: `${node} -e ${JSON.stringify(
          `require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`,
        )}`,
      },
      { cwd: project.root, signal: abort.signal },
    );
    const pid = Number(await waitForFile(pidPath));

    abort.abort();
    await assert.rejects(execution, /aborted/i);
    await waitForProcessExit(pid);
  });

  it("normalizes non-zero commands instead of throwing", async () => {
    const project = await createTempProject();
    const result = await executeBash(
      {
        command: `${node} -e "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)"`,
      },
      { cwd: project.root },
    );

    assert.equal(result.stdout, "out");
    assert.equal(result.stderr, "err");
    assert.equal(result.exitCode, 7);
    assert.match(result.content ?? "", /Command exited with code 7/);
  });
});
