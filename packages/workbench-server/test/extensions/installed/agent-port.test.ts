import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { sandbox } from "@nervekit/native";
import {
  createSdkEnvironment,
  findSdkMethod,
} from "@nervekit/tools/quick-script/testing";
import {
  ExtensionErrorLog,
  maxErrorsPerExtension,
  maxTrackedExtensions,
} from "../../../src/core-host/extension-catalog/extension-errors.js";
import { writeExtension, createTestCatalog } from "./fixtures.js";

const skip = !sandbox.isPersistentAvailable();
let root = "";
before(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-port-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

void test("the error log keeps the newest failures of a bounded set of extensions", () => {
  const log = new ExtensionErrorLog();
  for (let index = 0; index < maxErrorsPerExtension + 5; index++)
    log.record("a", "run", new Error(`failure ${index}`));
  const recent = log.recent("a");
  assert.equal(recent.length, maxErrorsPerExtension);
  assert.equal(recent.at(-1)?.message, `failure ${maxErrorsPerExtension + 4}`);
  assert.equal(recent[0]?.message, "failure 5");
  log.record(
    "b",
    "parse",
    Object.assign(new Error("x".repeat(2000)), { code: "BAD_REQUEST" }),
  );
  assert.equal(log.recent("b")[0]?.code, "BAD_REQUEST");
  assert.ok(log.recent("b")[0]!.message.length < 500);
  for (let index = 0; index < maxTrackedExtensions + 3; index++)
    log.record(`ext-${index}`, "run", "boom");
  assert.deepEqual(log.recent("a"), []);
  assert.equal(log.recent(`ext-${maxTrackedExtensions + 2}`).length, 1);
  log.clear(`ext-${maxTrackedExtensions + 2}`);
  assert.deepEqual(log.recent(`ext-${maxTrackedExtensions + 2}`), []);
});

void test(
  "extensions.reload and extensions.status report the project's extension and never touch consent",
  { skip },
  async () => {
    const base = join(root, "w");
    const home = join(base, "home");
    const userRoot = join(home, "agent", "extensions");
    const projectDir = join(base, "project");
    await mkdir(userRoot, { recursive: true });
    await mkdir(projectDir, { recursive: true });
    await writeExtension(userRoot, { id: "flow" });
    const catalog = createTestCatalog({ home });
    const port = catalog.agentPort({ projectDir, switchOf: () => false });
    const registry = await catalog.registryFor(projectDir);
    const env = createSdkEnvironment({
      registry,
      cwd: projectDir,
      extensionAgent: port,
    });
    const call = async (name: string, args: unknown[]) => {
      const prepared = await findSdkMethod(name, registry)!.prepare(args, env);
      return prepared.run(env) as Promise<Record<string, unknown>>;
    };

    // The namespace has exactly these two methods: there is no way to allow an extension from a script.
    const methods = registry.methods
      .filter((method) => method.product === "extensions")
      .map((method) => method.path)
      .sort();
    assert.deepEqual(methods, ["reload", "status"]);

    const pending = await call("extensions.status", ["flow"]);
    assert.equal(pending.state, "pending_consent");
    assert.equal(pending.consent, "pending");
    assert.equal(pending.source, "user");
    assert.equal(pending.folder, join(userRoot, "flow"));
    assert.ok(!("switch" in pending), "a pending extension has no switch yet");
    const reloaded = await call("extensions.reload", [{ id: "flow" }]);
    assert.equal(
      reloaded.state,
      "pending_consent",
      "reload never grants consent",
    );
    assert.doesNotMatch(
      JSON.stringify(reloaded),
      /contentHash|Adds agent tools/,
    );
    assert.equal(
      (await call("extensions.status", ["nope"])).state,
      "not_found",
    );
    assert.equal(
      (await call("extensions.status", ["diagram"])).consent,
      "not_required",
    );

    // The user allows it (Settings): loaded, with its own switch.
    const entry = (await catalog.entries(projectDir)).find(
      (e) => e.id === "flow",
    )!;
    await catalog.grantConsent(
      { source: "user", id: "flow" },
      entry.consent!.contentHash,
    );
    const granted = await call("extensions.status", ["flow"]);
    assert.equal(granted.consent, "granted");
    assert.equal(granted.state, "enabled");
    assert.equal(granted.switch, "off");
    await assert.rejects(
      findSdkMethod("extensions.reload", registry)!.prepare([""], env),
      /id must be a non-empty string/,
    );
  },
);

void test(
  "backend failures of an installed extension show in status until it is reloaded",
  { skip },
  async () => {
    const base = join(root, "errors");
    const home = join(base, "home");
    const userRoot = join(home, "agent", "extensions");
    await mkdir(userRoot, { recursive: true });
    await writeExtension(userRoot, { id: "flow" });
    const catalog = createTestCatalog({
      home,
      trustGate: { decide: () => "trusted" },
    });
    const registry = await catalog.registryFor(base);
    const env = createSdkEnvironment({ registry, cwd: base });
    // `echo` rejects a non-string argument in `parse`.
    await assert.rejects(
      findSdkMethod("probe.echo", registry)!.prepare([5], env),
    );
    await env.extensions.dispose();
    const port = catalog.agentPort({ projectDir: base });
    const status = await port.status("flow");
    assert.equal(status.consent, "granted");
    assert.equal(status.switch, "unknown");
    assert.equal(status.recentErrors.length, 1);
    assert.equal(status.recentErrors[0]?.operation, "parse");
    assert.equal(status.recentErrors[0]?.code, "BAD_REQUEST");
    assert.match(status.recentErrors[0]!.message, /echo needs a string/);
    assert.deepEqual((await port.reload("flow")).recentErrors, []);
  },
);
