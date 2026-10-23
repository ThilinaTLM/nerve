import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackgroundProcess } from "@nervekit/conversation-core";
import type { CoreProcessHost } from "./process.adapter.js";
import { createToolHostPort } from "./tool-host.adapter.js";

void test("bash host validates turn settings, project cwd and untimed background readiness", async () => {
  const project = await mkdtemp(join(tmpdir(), "nerve-bash-host-"));
  const outside = await mkdtemp(join(tmpdir(), "nerve-bash-outside-"));
  try {
    const stdout = join(project, "stdout.txt");
    const stderr = join(project, "stderr.txt");
    const combined = join(project, "output.txt");
    await Promise.all([
      writeFile(stdout, "hello"),
      writeFile(stderr, ""),
      writeFile(combined, "hello"),
    ]);
    let exitCode: number | null = 0;
    const process: BackgroundProcess = {
      ref: "process",
      launch: {
        cwd: project,
        executable: "direnv",
        shell: "/bin/bash",
        manager: "direnv",
        configFile: join(project, ".envrc"),
      },
      outputFiles: { stdout, stderr, combined },
      wait: async () => ({
        exitCode,
        status:
          exitCode === null
            ? "cancelled"
            : exitCode === 0
              ? "completed"
              : "failed",
      }),
      cancel: async () => {},
    };
    let started: Parameters<CoreProcessHost["start"]>[0] | undefined;
    let spawned: Parameters<CoreProcessHost["spawn"]>[0] | undefined;
    const host = {
      spawn: async (input: Parameters<CoreProcessHost["spawn"]>[0]) => {
        spawned = input;
        return process;
      },
      start: async (input: Parameters<CoreProcessHost["start"]>[0]) => {
        started = input;
        return { process, readiness: { status: "ready" as const } };
      },
    } as unknown as CoreProcessHost;
    const settings = {
      autoPromotion: { enabled: false, afterMs: 120000 },
      maxTimeoutMs: 2000,
    };
    const tools = createToolHostPort(host, async () => ({
      context: { cwd: project },
      bash: structuredClone(settings),
      target: {},
    }));
    const execute = (
      args: Record<string, unknown>,
      origin: "model" | "user" = "model",
    ) =>
      tools.port.execute({
        toolCallId: "tool",
        conversationId: "conversation",
        origin,
        toolName: "bash",
        args,
        cwd: project,
        projectDir: project,
        artifactDir: project,
        signal: new AbortController().signal,
        onProgress: () => {},
      });
    await assert.rejects(
      execute({ command: "echo" }),
      /Invalid bash arguments/,
    );
    for (const projectEnvironment of [null, "false", 0]) {
      await assert.rejects(
        execute({ command: "echo", timeout: 1, projectEnvironment }),
        /Invalid bash arguments/,
      );
    }
    settings.maxTimeoutMs = 2001;
    await execute({ command: "echo" }, "user");
    assert.equal(spawned?.timeoutMs, 2001);
    settings.maxTimeoutMs = 2000;
    await assert.rejects(
      execute({ command: "echo", timeout: 3 }),
      /Invalid bash arguments/,
    );
    await assert.rejects(
      execute({ command: "echo", timeout: 1, cwd: ".." }),
      /inside the project/,
    );
    await assert.rejects(
      execute({ command: "echo", timeout: 1, cwd: outside }),
      /inside the project/,
    );
    await assert.rejects(
      execute({ command: "echo", timeout: 1, ready: "ready" }),
      /background:true/,
    );
    const result = await execute({ command: "echo", timeout: 1 });
    assert.equal(spawned?.timeoutMs, 1000);
    assert.equal(result.kind, "completed");
    if (result.kind === "completed") {
      assert.deepEqual(
        (result.result.details as { launch: unknown }).launch,
        process.launch,
      );
      assert.equal(result.result.stdout, "hello");
      assert.equal(result.result.stderr, "");
      assert.equal(result.result.exitCode, 0);
      assert.equal(
        result.result.content,
        "Status: completed; exit code: 0\nhello",
      );
    }
    for (const origin of ["model", "user"] as const) {
      for (const code of [0, 7, null]) {
        exitCode = code;
        const completed = await execute(
          { command: "echo", timeout: 1 },
          origin,
        );
        assert.equal(completed.kind, "completed");
        if (completed.kind !== "completed")
          throw new Error("Expected completion");
        const status =
          code === null ? "cancelled" : code === 0 ? "completed" : "failed";
        assert.equal(completed.result.exitCode, code ?? undefined);
        assert.ok(
          completed.result.details &&
            typeof completed.result.details === "object" &&
            "exitCode" in completed.result.details,
        );
        assert.equal(completed.result.details.exitCode, code);
        assert.equal(
          completed.result.content,
          `Status: ${status}; exit code: ${code ?? "unknown"}\nhello`,
        );
      }
    }
    exitCode = 0;
    const backgrounded = await execute({
      command: "echo",
      timeout: 2,
      background: true,
      ready: "READY",
    });
    assert.deepEqual(
      (backgrounded.result.details as { launch: unknown }).launch,
      process.launch,
    );
    assert.equal(started?.timeoutMs, undefined);
    assert.deepEqual(started?.ready, {
      kind: "pattern",
      pattern: "READY",
      timeoutMs: 60000,
    });
    settings.autoPromotion.enabled = true;
    await assert.rejects(
      execute({ command: "echo", timeout: 1 }),
      /Invalid bash arguments/,
    );
    await execute({ command: "echo" });
    assert.equal(spawned?.timeoutMs, undefined);
    settings.autoPromotion.afterMs = 1;
    process.wait = () => new Promise(() => {});
    const promoted = await execute({ command: "echo" });
    assert.equal(promoted.kind, "backgrounded");
    assert.deepEqual(
      (promoted.result.details as { launch: unknown }).launch,
      process.launch,
    );
  } finally {
    await Promise.all([
      rm(project, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  }
});

void test("launch is advertised only with a handler and receives conversation, origin and signal", async () => {
  const calls: unknown[][] = [];
  const launchTool = {
    prepare: async (...args: unknown[]) => ({
      cwd: tmpdir(),
      target: {},
      dispatch: async () => {
        calls.push(args);
        return { content: "launchdef_dev Dev idle" };
      },
    }),
  } as unknown as import("./launch-tool.js").LaunchTool;
  const bash = {
    autoPromotion: { enabled: true, afterMs: 120000 },
    maxTimeoutMs: 900000,
  };
  const create = (handler?: typeof launchTool) =>
    createToolHostPort(
      {} as CoreProcessHost,
      async () => ({ context: { cwd: tmpdir() }, bash, target: {} }),
      handler,
    );
  assert.equal(
    (await create().definitions(tmpdir(), undefined, bash)).some(
      (tool) => tool.name === "launch",
    ),
    false,
  );
  const tools = create(launchTool);
  assert.equal(
    (await tools.definitions(tmpdir(), undefined, bash)).some(
      (tool) => tool.name === "launch",
    ),
    true,
  );
  const signal = new AbortController().signal;
  const args = { action: "status" };
  const result = await tools.port.execute({
    toolCallId: "tool",
    conversationId: "conv_one",
    origin: "user",
    toolName: "launch",
    args,
    cwd: tmpdir(),
    projectDir: tmpdir(),
    artifactDir: "/output",
    signal,
    onProgress: () => {},
  });
  assert.equal(result.kind, "completed");
  assert.deepEqual(calls, [[args, "conv_one", "user", signal, undefined]]);
  for (const action of ["start", "restart"] as const) {
    await tools.port.execute({
      toolCallId: "tool",
      conversationId: "conv_one",
      origin: "model",
      toolName: "launch",
      args: { action, name: "Dev" },
      cwd: tmpdir(),
      projectDir: tmpdir(),
      artifactDir: "/output",
      signal,
      onProgress: () => {},
    });
  }
  assert.equal(
    calls.length,
    3,
    "launch process creation uses prepared dispatch",
  );
});

void test("advertising captured bash settings never reloads scoped configuration", async () => {
  const tools = createToolHostPort({} as CoreProcessHost, async () => {
    throw new Error("Must not reload captured settings");
  });
  const definitions = await tools.definitions("/project", "conversation", {
    autoPromotion: { enabled: false, afterMs: 1000 },
    maxTimeoutMs: 5000,
  });
  const bash = definitions.find((tool) => tool.name === "bash");
  assert.ok(bash);
  assert.ok(
    (bash.parameters as unknown as { required: string[] }).required.includes(
      "timeout",
    ),
  );
});

void test("prepared dispatch owns normalized arguments and the non-secret execution target", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nerve-prepared-host-"));
  await writeFile(join(cwd, "file.txt"), "captured file");
  let preparations = 0;
  const account = { id: "selected-account", endpoint: "original" };
  const tools = createToolHostPort({} as CoreProcessHost, async () => {
    preparations++;
    return {
      context: { cwd },
      bash: {
        autoPromotion: { enabled: true, afterMs: 1000 },
        maxTimeoutMs: 5000,
      },
      target: { account },
    };
  });
  const input = {
    toolCallId: "call",
    conversationId: "c",
    origin: "model" as const,
    toolName: "read",
    cwd,
    projectDir: cwd,
    args: { path: "file.txt" },
    artifactDir: cwd,
    signal: new AbortController().signal,
    onProgress: () => {},
  };
  try {
    const prepared = await tools.port.prepareExecution!(input);
    if ("kind" in prepared) return assert.fail("Expected prepared dispatch");
    input.args.path = "different.txt";
    account.endpoint = "changed";
    const result = await prepared.dispatch();
    assert.equal(result.kind, "completed");
    assert.match(result.result.content ?? "", /captured file/);
    assert.deepEqual((prepared.target as { account: unknown }).account, {
      id: "selected-account",
      endpoint: "original",
    });
    assert.equal(preparations, 1);
    const recovered = await tools.port.prepareExecution!({
      ...input,
      args: { path: "file.txt" },
    });
    if ("kind" in recovered) return assert.fail("Expected recovered dispatch");
    assert.deepEqual(
      (recovered.target as { account: unknown }).account,
      account,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
