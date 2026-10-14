import assert from "node:assert/strict";
import test from "node:test";
import {
  describePlan,
  executePlan,
  main,
  parseArguments,
} from "../focused-validation-runner.mjs";

function fixture(overrides = {}) {
  return {
    mode: "focused",
    operation: "check",
    base: "origin/main",
    baseline: "abc123",
    reason: "Changed package inputs",
    files: { format: ["packages/a/file with spaces.ts"], lint: [] },
    packages: ["@nervekit/a"],
    commands: [
      {
        command: "pnpm",
        args: [
          "exec",
          "oxfmt",
          "--check",
          "--",
          "packages/a/file with spaces.ts",
        ],
        reason: "Check formatting",
      },
      {
        command: "node",
        args: ["scripts/checks/check-package-boundaries.mjs"],
        reason: "Check boundaries",
      },
    ],
    ...overrides,
  };
}

const quiet = () => {};

test("CLI defaults and explicit options", () => {
  assert.deepEqual(parseArguments([], "fix"), {
    base: "origin/main",
    dryRun: false,
  });
  assert.deepEqual(parseArguments(["--dry-run", "--base", "HEAD"], "check"), {
    base: "HEAD",
    dryRun: true,
  });
  for (const args of [
    ["--base"],
    ["--base", "--dry-run"],
    ["--base", "-bad"],
    ["--base", " "],
    ["--unknown"],
    ["HEAD"],
    ["--dry-run", "--dry-run"],
    ["--base", "HEAD", "--base", "main"],
  ])
    assert.throws(() => parseArguments(args, "fix"), /Usage: pnpm fix:focused/);
});

test("report includes baseline, selection, reasons, commands and full-fix warning", () => {
  const report = describePlan(fixture());
  for (const text of [
    "Focused check: focused",
    "origin/main (abc123)",
    "Changed package inputs",
    "Format files (1)",
    "Lint files (0)",
    "@nervekit/a",
    '"packages/a/file with spaces.ts"',
    "Check formatting",
  ])
    assert.ok(report.includes(text), text);
  const full = describePlan(fixture({ mode: "full", operation: "fix" }));
  assert.match(
    full,
    /WARNING: full fix may modify files throughout the repository/,
  );
  assert.match(describePlan(fixture({ commands: [] })), /No commands needed/);
});

test("execution preserves argument arrays and root cwd without a shell", () => {
  const calls = [];
  const plan = fixture();
  executePlan(plan, "/repo root", {
    log: quiet,
    pnpmPath: "",
    spawn: (...args) => {
      calls.push(args);
      return { status: 0 };
    },
  });
  assert.deepEqual(
    calls,
    plan.commands.map((step) => [
      step.command,
      step.args,
      { cwd: "/repo root", stdio: "inherit", shell: false },
    ]),
  );
});

test("dry run never spawns, including full fallback", () => {
  for (const plan of [
    fixture(),
    fixture({
      mode: "full",
      commands: [
        { command: "pnpm", args: ["run", "check"], reason: "Fallback" },
      ],
    }),
  ])
    executePlan(plan, "/repo", {
      dryRun: true,
      spawn: () => assert.fail("spawned"),
    });
});

test("failure, signal and spawn error all stop subsequent commands", () => {
  const error = new Error("ENOENT");
  for (const result of [
    { status: 2 },
    { status: null, signal: "SIGTERM" },
    { error },
  ]) {
    let calls = 0;
    assert.throws(
      () =>
        executePlan(fixture(), "/repo", {
          log: quiet,
          spawn: () => {
            calls++;
            return result;
          },
        }),
      result.error ? /ENOENT/ : /failed/,
    );
    assert.equal(calls, 1);
  }
});

test("full fallback runs once and recursive or malformed fallback is rejected", () => {
  const step = {
    command: "pnpm",
    args: ["run", "fix"],
    reason: "Unknown ownership",
  };
  let calls = 0;
  executePlan(
    fixture({ mode: "full", operation: "fix", commands: [step] }),
    "/repo",
    {
      pnpmPath: "",
      log: quiet,
      spawn: () => {
        calls++;
        return { status: 0 };
      },
    },
  );
  assert.equal(calls, 1);
  for (const commands of [
    [],
    [step, step],
    [{ ...step, args: ["run", "fix:focused"] }],
  ])
    assert.throws(
      () =>
        executePlan(
          fixture({ mode: "full", operation: "fix", commands }),
          "/repo",
          { dryRun: true },
        ),
      /exactly once/,
    );
  assert.throws(
    () =>
      executePlan(
        fixture({ commands: [{ command: "pnpm", args: "run check" }] }),
        "/repo",
        { spawn: () => assert.fail("spawned") },
      ),
    /Invalid validation command/,
  );
});

test("pnpm CLI uses Node when available, otherwise standard spawn, always without a shell", () => {
  for (const pnpmPath of [
    "C:\\Program Files\\pnpm.cjs",
    "/tools/pnpm.js",
    "",
    "/tools/npm-cli.js",
    "/tools/not-pnpm.cjs",
  ]) {
    const calls = [];
    executePlan(fixture(), "/repo", {
      pnpmPath,
      log: quiet,
      spawn: (...args) => {
        calls.push(args);
        return { status: 0 };
      },
    });
    const isPnpm =
      pnpmPath === "C:\\Program Files\\pnpm.cjs" ||
      pnpmPath === "/tools/pnpm.js";
    assert.equal(calls[0][0], isPnpm ? process.execPath : "pnpm");
    assert.deepEqual(
      calls[0][1],
      isPnpm
        ? [pnpmPath, ...fixture().commands[0].args]
        : fixture().commands[0].args,
    );
    assert.equal(calls[0][2].shell, false);
    assert.equal(calls[1][0], "node");
  }
});

test("main parses before planning, forwards operation/base and reports dry run", async () => {
  const logs = [];
  const exits = [];
  let planned = 0;
  const dependencies = {
    args: ["--base", "HEAD", "--dry-run"],
    log: (line) => logs.push(line),
    error: quiet,
    setExitCode: (code) => exits.push(code),
    spawn: () => assert.fail("spawned"),
    planFocusedValidation: async (root, operation, base) => {
      await Promise.resolve();
      planned++;
      assert.deepEqual([root, operation, base], ["/repo", "check", "HEAD"]);
      return fixture({ base });
    },
  };
  await main("check", "/repo", dependencies);
  assert.equal(planned, 1);
  assert.deepEqual(exits, []);
  assert.match(logs.join("\n"), /Dry run: no validation commands executed/);
  await main("check", "/repo", { ...dependencies, args: ["--bad"] });
  assert.equal(planned, 1);
  assert.deepEqual(exits, [1]);
});

test("main reports planning and execution failures as unsuccessful exits", async () => {
  for (const planningFailure of [true, false]) {
    const errors = [];
    const exits = [];
    await main("fix", "/repo", {
      args: [],
      log: quiet,
      error: (message) => errors.push(message),
      setExitCode: (code) => exits.push(code),
      planFocusedValidation: () => {
        if (planningFailure) throw new Error("Planning failed");
        return fixture();
      },
      spawn: () => ({ status: 3 }),
    });
    assert.deepEqual(exits, [1]);
    assert.match(
      errors[0],
      planningFailure ? /Planning failed/ : /failed \(3\)/,
    );
  }
});
