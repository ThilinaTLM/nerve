import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import {
  setImmediate as immediate,
  setTimeout as delay,
} from "node:timers/promises";
import { test } from "node:test";
import type {
  ManagedProcess,
  ManagedProcessExit,
  ManagedProcessOptions,
} from "@nervekit/native";
import {
  createGitIsolatedReader,
  gitIsolatedReaderLaunch,
} from "../../../src/git/read/git-isolated-reader.js";
import {
  GIT_ISOLATED_OUTPUT_BYTES,
  GIT_ISOLATED_STDERR_BYTES,
  normalizeGitIsolatedSnapshot,
  serializeGitIsolatedFrame,
} from "../../../src/git/read/git-isolated-reader-protocol.js";

const repository = {
  relativePath: ".",
  workDir: "/synthetic",
  gitDir: "/synthetic/.git",
  commonDir: "/synthetic/.git",
};
const snapshot = normalizeGitIsolatedSnapshot({
  detached: false,
  branch: "main",
  files: [],
  inProgress: ["rebase"],
});
const frame = serializeGitIsolatedFrame({
  version: 1,
  ok: true,
  identity: repository,
  snapshot,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
function child(autoClose = false) {
  const stdout = new PassThrough(),
    stderr = new PassThrough();
  const ended = deferred<ManagedProcessExit>();
  const closed = deferred<ManagedProcessExit>();
  const signals: string[] = [];
  const finish = () => {
    const value: ManagedProcessExit = {
      exitCode: null,
      signal: "SIGKILL",
      reason: "signal",
    };
    stdout.end();
    stderr.end();
    ended.resolve(value);
    closed.resolve(value);
  };
  const process: ManagedProcess = {
    pid: 1,
    identity: "synthetic",
    containment: "process-group",
    target: { pid: 1, identity: "synthetic", containment: "process-group" },
    enforcement: [],
    stdout,
    stderr,
    exited: ended.promise,
    closed: closed.promise,
    outputStats: Promise.resolve({
      stdoutObservedBytes: 0,
      stderrObservedBytes: 0,
      stdoutDeliveredBytes: 0,
      stderrDeliveredBytes: 0,
      stdoutOmittedBytes: 0,
      stderrOmittedBytes: 0,
      totalObservedBytes: 0,
      totalDeliveredBytes: 0,
      totalOmittedBytes: 0,
    }),
    async terminate(signal) {
      signals.push(signal ?? "SIGKILL");
      if (signal === "SIGKILL" && autoClose) finish();
      return { attempted: true, terminated: true, method: "process-group" };
    },
  };
  return { process, signals, stdout, stderr, finish };
}
function world(autoClose = false) {
  const children: ReturnType<typeof child>[] = [];
  const launches: {
    command: string;
    args: string[];
    options?: ManagedProcessOptions;
  }[] = [];
  const reader = createGitIsolatedReader({
    launch: () => ["synthetic-helper.js"],
    terminationGraceMs: 1,
    spawn(command, args, options) {
      const value = child(autoClose);
      children.push(value);
      launches.push({ command, args, options });
      return value.process;
    },
  });
  return { reader, children, launches };
}

test("valid frame keeps the permit and promise until contained helper closure", async () => {
  const { reader, children, launches } = world();
  const pending = reader.read(repository);
  let settled = false;
  void pending
    .finally(() => {
      settled = true;
    })
    .catch(() => {});
  await immediate();
  children[0]!.stdout.write(frame);
  await immediate();
  assert.equal(settled, false);
  assert.equal(children[0]!.signals[0], "SIGTERM");
  assert.equal(launches[0]!.options?.policy?.maxCpuCores, 2);
  assert.equal(launches[0]!.options?.policy?.maxProcesses, 32);
  assert.deepEqual(JSON.parse(launches[0]!.args.at(-1)!), {
    expected: {
      workDir: repository.workDir,
      gitDir: repository.gitDir,
      commonDir: repository.commonDir,
    },
    includeIgnored: false,
  });
  children[0]!.finish();
  assert.deepEqual(await pending, snapshot);
  await reader.close();
});
test("abort requests TERM/KILL but never rejects while helper remains open", async () => {
  const { reader, children } = world();
  const abort = new AbortController();
  const pending = reader.read(repository, { signal: abort.signal });
  const rejected = assert.rejects(pending, { category: "cancelled" });
  let settled = false;
  void pending
    .finally(() => {
      settled = true;
    })
    .catch(() => {});
  await immediate();
  abort.abort();
  await delay(5);
  assert.deepEqual(children[0]!.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(settled, false);
  children[0]!.finish();
  await rejected;
  await reader.close();
});
test("global admission bounds two active and sixteen waiting across adapters", async () => {
  const a = world(true),
    b = world(true);
  const controllers = Array.from({ length: 18 }, () => new AbortController());
  const pending = controllers.map((controller, i) =>
    (i % 2 ? a : b).reader.read(repository, { signal: controller.signal }).then(
      () => "success",
      (error) => error,
    ),
  );
  await assert.rejects(a.reader.read(repository), {
    category: "limit_exceeded",
    retryable: true,
  });
  await immediate();
  assert.equal(a.children.length + b.children.length, 2);
  controllers[5]!.abort();
  assert.equal((await pending[5]).category, "cancelled");
  // A queue slot is immediately reusable; its own deadline can expire without spawning.
  await assert.rejects(a.reader.read(repository, { timeoutMs: 1 }), {
    category: "io",
  });
  assert.equal(a.children.length + b.children.length, 2);
  await Promise.all([a.reader.close(), b.reader.close()]);
  for (const result of await Promise.all(pending))
    assert.equal(result.category, "cancelled");
});
test("close aborts queued work promptly and awaits all owned active helpers", async () => {
  const { reader, children } = world();
  const pending = [
    reader.read(repository),
    reader.read(repository),
    reader.read(repository),
  ].map((promise) => promise.catch((error) => error));
  await immediate();
  let closed = false;
  const closing = reader.close().then(() => {
    closed = true;
  });
  assert.equal((await pending[2]).category, "cancelled");
  await immediate();
  assert.equal(closed, false);
  for (const value of children) value.finish();
  await closing;
  await Promise.all(pending);
  await assert.rejects(reader.read(repository), { category: "cancelled" });
});
test("deadline, stream/protocol failures and overflow drain then return sanitized errors", async () => {
  const cases: [string, (value: ReturnType<typeof child>) => void, string][] = [
    [
      "malformed",
      (value) => {
        value.stdout.write("secret-filter-output\n");
      },
      "corrupt",
    ],
    [
      "stdout",
      (value) => {
        value.stdout.write(Buffer.alloc(GIT_ISOLATED_OUTPUT_BYTES + 1));
      },
      "limit_exceeded",
    ],
    [
      "stderr",
      (value) => {
        value.stderr.write(Buffer.alloc(GIT_ISOLATED_STDERR_BYTES + 1));
      },
      "limit_exceeded",
    ],
    [
      "stream",
      (value) => {
        value.stdout.emit("error", new Error("secret-filter-output"));
      },
      "io",
    ],
    [
      "extra frame",
      (value) => {
        value.stdout.write(frame);
        value.stdout.write("secret-filter-output\n");
      },
      "corrupt",
    ],
    [
      "remote error",
      (value) => {
        value.stdout.write(
          JSON.stringify({
            version: 1,
            ok: false,
            error: { category: "io", message: "secret-filter-output" },
          }) + "\n",
        );
      },
      "io",
    ],
  ];
  for (const [, send, category] of cases) {
    const { reader, children } = world(true);
    const pending = reader.read(repository);
    const checked = assert.rejects(pending, (error: unknown) => {
      assert.equal((error as { category: string }).category, category);
      assert.ok(!String(error).includes("secret-filter-output"));
      return true;
    });
    await immediate();
    send(children[0]!);
    await checked;
    await reader.close();
  }
  const { reader } = world(true);
  await assert.rejects(reader.read(repository, { timeoutMs: 1 }), {
    category: "io",
  });
  await reader.close();
});
test("oversized expected identity fails before helper admission/spawn", async () => {
  const { reader, children } = world();
  const path = "/" + "x".repeat(3000);
  await assert.rejects(
    reader.read({
      relativePath: ".",
      workDir: path,
      gitDir: path,
      commonDir: path,
    }),
    { category: "limit_exceeded", retryable: false },
  );
  assert.equal(children.length, 0);
  await reader.close();
});
test("compiled helper needs no dev loader; source forwards loader flags only", () => {
  const compiled = gitIsolatedReaderLaunch(
    pathToFileURL(resolve("dist/git-isolated-reader.js")).href,
    ["--import", "tsx", "--test"],
  );
  assert.ok(compiled.at(-1)!.endsWith("git-isolated-reader-helper.js"));
  assert.ok(!compiled.includes("tsx"));
  const source = gitIsolatedReaderLaunch(
    pathToFileURL(resolve("src/git-isolated-reader.ts")).href,
    ["--test", "--inspect", "--import", "tsx", "--require=x"],
  );
  assert.ok(source.at(-1)!.endsWith("git-isolated-reader-helper.ts"));
  assert.ok(source.includes("tsx"));
  assert.ok(!source.includes("--test"));
  assert.ok(!source.includes("--inspect"));
});
