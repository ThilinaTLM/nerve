import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { executeBash } from "../src/execution/index.js";
import { createTempProject } from "./helpers.js";

const node = JSON.stringify(process.execPath);

describe("bash executor", () => {
  it("rejects empty commands", async () => {
    await assert.rejects(
      executeBash({ command: "   " }, { cwd: process.cwd() }),
      /command.*non-empty string/,
    );
  });

  it("uses non-interactive pager-safe environment defaults", async () => {
    const project = await createTempProject();
    const result = await executeBash(
      {
        command: `${node} -e "process.stdout.write(JSON.stringify({ PAGER: process.env.PAGER, GIT_PAGER: process.env.GIT_PAGER, GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT, TERM: process.env.TERM, CI: process.env.CI }))"`,
      },
      { cwd: project.root },
    );
    const env = JSON.parse(result.stdout ?? "{}") as Record<string, string>;

    assert.equal(env.PAGER, "cat");
    assert.equal(env.GIT_PAGER, "cat");
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.TERM, "dumb");
    assert.equal(env.CI, process.env.CI ?? "1");
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
    assert.match(details.fullOutputPath, /tmp\/tool-outputs\/nerve-bash-/);
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

  it("saves mixed stdout and stderr to the same transcript", async () => {
    const project = await createTempProject();
    const result = await executeBash(
      {
        command: `${node} -e "for (let i = 0; i < 700; i++) { if (i % 2) process.stderr.write('err ' + i + '\\n'); else process.stdout.write('out ' + i + '\\n'); }"`,
      },
      { cwd: project.root, dataDir: project.root },
    );

    const details = result.details as {
      fullOutputPath?: string;
      streams?: {
        stdout?: { savedTo?: string; lines?: number };
        stderr?: { savedTo?: string; lines?: number };
        combined?: { savedTo?: string; lines?: number };
      };
    };
    assert.ok(details.fullOutputPath);
    assert.equal(details.streams?.stdout?.savedTo, undefined);
    assert.equal(details.streams?.stderr?.savedTo, undefined);
    assert.equal(details.streams?.combined?.savedTo, details.fullOutputPath);
    assert.ok((details.streams?.stdout?.lines ?? 0) > 0);
    assert.ok((details.streams?.stderr?.lines ?? 0) > 0);

    const transcript = await readFile(details.fullOutputPath, "utf8");
    assert.match(transcript, /out 0/);
    assert.match(transcript, /err 1/);
  });

  it("saves overlong single-line output below aggregate limits", async () => {
    const project = await createTempProject();
    const result = await executeBash(
      {
        command: `${node} -e "process.stdout.write('x'.repeat(5000))"`,
      },
      { cwd: project.root, dataDir: project.root },
    );

    assert.match(result.content ?? "", /contained overlong lines/);
    assert.match(result.stdout ?? "", /truncated/);
    assert.ok((result.stdout ?? "").length < 2600);
    const details = result.details as {
      fullOutputPath?: string;
      truncation?: { truncatedLines?: number };
      streams?: { stdout?: { truncatedLines?: number } };
    };
    assert.ok(details.fullOutputPath);
    assert.equal(details.truncation?.truncatedLines, 1);
    assert.equal(details.streams?.stdout?.truncatedLines, 1);
    const transcript = await readFile(details.fullOutputPath, "utf8");
    assert.equal(transcript, "x".repeat(5000));
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
