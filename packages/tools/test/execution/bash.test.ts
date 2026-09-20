import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { describe, it } from "node:test";
import { executeBash } from "../../src/execution/shell/bash.js";
import {
  createTempProject,
  withPath,
  writeExecutable,
} from "../support/project-fixtures.js";

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

  it("applies executable project environment adapters", async () => {
    for (const fixture of [
      { manager: "direnv", config: ".envrc" },
      { manager: "mise", config: "mise.toml" },
      { manager: "fnm", config: ".node-version" },
    ] as const) {
      const project = await createTempProject(`nerve-${fixture.manager}-`);
      await project.write(fixture.config, "24\n");
      await project.write("nested/.keep", "");
      const body =
        fixture.manager === "direnv"
          ? `const { spawnSync } = require('node:child_process'); process.env.NERVE_MANAGER = 'direnv'; const result = spawnSync(process.argv[4], process.argv.slice(5), { env: process.env, stdio: 'inherit' }); process.exit(result.status ?? 1);`
          : `const { spawnSync } = require('node:child_process'); process.env.NERVE_MANAGER = ${JSON.stringify(fixture.manager)}; const separator = process.argv.indexOf('--'); const result = spawnSync(process.argv[separator + 1], process.argv.slice(separator + 2), { env: process.env, stdio: 'inherit' }); process.exit(result.status ?? 1);`;
      await writeExecutable(project.root, fixture.manager, body);

      const result = await withPath(
        `${project.root}${delimiter}${process.env.PATH ?? ""}`,
        () =>
          executeBash(
            {
              command: `${node} -e "process.stdout.write(process.env.NERVE_MANAGER ?? 'none')"`,
              cwd: "nested",
            },
            { cwd: project.root },
          ),
      );

      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, fixture.manager);
    }
  });

  it("sources nvm for an ancestor .nvmrc without changing the parent environment", async (t) => {
    if (process.platform === "win32") {
      t.skip("nvm shell activation is POSIX-only.");
      return;
    }
    const project = await createTempProject("nerve-nvm-");
    const nvmDir = await project.write(
      "nvm/nvm.sh",
      `nvm() { export NERVE_MANAGER=nvm; return 0; }\n`,
    );
    await project.write(".nvmrc", "24\n");
    await project.write("nested/.keep", "");
    const previousNvmDir = process.env.NVM_DIR;
    delete process.env.NERVE_MANAGER;
    process.env.NVM_DIR = dirname(nvmDir);
    try {
      const result = await executeBash(
        {
          command: `${node} -e "process.stdout.write(process.env.NERVE_MANAGER ?? 'none')"`,
          cwd: "nested",
        },
        { cwd: project.root },
      );
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "nvm");
      assert.equal(process.env.NERVE_MANAGER, undefined);
    } finally {
      if (previousNvmDir === undefined) delete process.env.NVM_DIR;
      else process.env.NVM_DIR = previousNvmDir;
    }
  });

  it("does not run the command when project environment activation fails", async () => {
    const project = await createTempProject("nerve-direnv-failure-");
    await project.write(".envrc", "export SHOULD_NOT_RUN=1\n");
    await writeExecutable(
      project.root,
      "direnv",
      `process.stderr.write('environment is not allowed'); process.exit(1);`,
    );

    const result = await withPath(
      `${project.root}${delimiter}${process.env.PATH ?? ""}`,
      () => executeBash({ command: "echo command-ran" }, { cwd: project.root }),
    );

    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr ?? "", /not allowed/);
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
      { cwd: project.root },
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
    assert.match(details.fullOutputPath, /nerve-tool-outputs[\\/]nerve-bash-/);
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
