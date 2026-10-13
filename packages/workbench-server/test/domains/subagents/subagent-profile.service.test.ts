import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "node:test";
import type { SubagentProfileDiagnostic } from "@nervekit/contracts/subagents";
import type { ConversationConfig } from "@nervekit/contracts/core";
import {
  SubagentProfileService,
  type SubagentProfileServiceDeps,
} from "../../../src/domains/subagents/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const context = { projectId: "proj_one", conversationId: "conv_one" };
async function setup(
  availability?: SubagentProfileServiceDeps["availability"],
) {
  const root = await mkdtemp(join(tmpdir(), "nerve-profiles-"));
  roots.push(root);
  const project = join(root, "project");
  const userPath = join(root, "home", "config", "subagents.json");
  const conversationsPath = join(root, "home", "data", "conversations");
  await mkdir(project);
  const trusted = new Map<string, string>();
  const changes: unknown[] = [];
  let diagnostics: SubagentProfileDiagnostic[] = [];
  const service = new SubagentProfileService({
    userPath,
    conversationsPath,
    getProject: (id) => {
      if (id !== context.projectId) throw new Error("Unknown project");
      return { id, directory: project };
    },
    getConversation: (id) => {
      if (id !== context.conversationId)
        throw new Error("Unknown conversation");
      return { projectId: context.projectId };
    },
    trust: {
      isTrusted: (_kind, _project, path, digest) =>
        trusted.get(path) === digest,
      decide: (input) => {
        trusted.set(input.path, input.contentDigest);
        return input as never;
      },
    },
    events: {
      publish: async (_type, change) => {
        changes.push(change);
      },
    },
    availability: availability ?? (async () => diagnostics),
  });
  const projectPath = join(project, ".nerve", "config", "subagents.json");
  const conversationPath = join(
    conversationsPath,
    context.conversationId,
    "config",
    "subagents.json",
  );
  const write = async (path: string, profiles: unknown) => {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify({ schemaVersion: 1, profiles }));
  };
  return {
    service,
    root,
    project,
    userPath,
    projectPath,
    conversationPath,
    write,
    changes,
    setDiagnostics: (value: SubagentProfileDiagnostic[]) => {
      diagnostics = value;
    },
  };
}

it("pins sparse values and resets to inheritance without changing lower files", async () => {
  const { service, userPath, conversationPath, changes } = await setup();
  await service.update({
    scope: "user",
    name: "developer",
    patch: { enabled: false },
  });
  const userBefore = await readFile(userPath, "utf8");
  await service.update({
    scope: "project",
    projectId: context.projectId,
    name: "developer",
    patch: { enabled: false },
  });
  await service.update({
    scope: "conversation",
    ...context,
    name: "developer",
    patch: { enabled: true, model: "lead" },
  });
  assert.equal(await readFile(userPath, "utf8"), userBefore);
  assert.equal((await service.find(context, "developer"))?.enabled, true);
  assert.deepEqual(
    JSON.parse(await readFile(conversationPath, "utf8")).profiles.developer,
    { enabled: true, model: "lead" },
  );
  const reset = await service.reset({
    scope: "conversation",
    ...context,
    name: "developer",
    field: "enabled",
  });
  assert.equal(
    reset.profiles.find((item) => item.name === "developer")?.effective
      ?.enabled,
    false,
  );
  assert.deepEqual(changes.at(-1), context);
  const project = await service.configuration({
    scope: "project",
    projectId: context.projectId,
  });
  assert.deepEqual(
    project.profiles.find((item) => item.name === "developer")?.local,
    { enabled: false },
  );
});

it("trusts the exact whole project document and never bypasses it with conversation enablement", async () => {
  const { service, projectPath, write } = await setup();
  await write(projectPath, {
    developer: { instructions: "External instructions", enabled: true },
  });
  await service.update({
    scope: "conversation",
    ...context,
    name: "developer",
    patch: { enabled: true },
  });
  assert.equal(
    (await service.usable(context)).some(
      (profile) => profile.name === "developer",
    ),
    false,
  );
  assert.match(
    (await service.find(context, "developer"))?.error ?? "",
    /Trust/,
  );
  assert.equal(
    (await service.usable(context)).some(
      (profile) => profile.name === "explore",
    ),
    true,
  );
  const configuration = await service.configuration({
    scope: "project",
    projectId: context.projectId,
  });
  await service.trust(context.projectId, configuration.digest!);
  assert.equal((await service.find(context, "developer"))?.trust, "trusted");
  await writeFile(projectPath, `${await readFile(projectPath, "utf8")}\n`);
  assert.equal((await service.find(context, "developer"))?.trust, "untrusted");
  await assert.rejects(
    service.trust(context.projectId, configuration.digest!),
    /changed/,
  );
});

it("does not trust untouched imported profiles when another entry is edited or reset", async () => {
  const { service, projectPath, write } = await setup();
  const input = { scope: "project" as const, projectId: context.projectId };
  await write(projectPath, {
    developer: {
      enabled: false,
      instructions: "Imported developer instructions",
    },
    explore: { enabled: true, instructions: "Untouched imported instructions" },
  });
  const assertTrust = async (trust: "trusted" | "untrusted") => {
    const configuration = await service.configuration(input);
    assert.equal(configuration.trust, trust);
    for (const name of ["developer", "explore"]) {
      assert.equal(
        configuration.profiles.find((profile) => profile.name === name)?.trust,
        trust,
      );
    }
  };
  await service.update({
    ...input,
    name: "developer",
    patch: { enabled: true },
  });
  await assertTrust("untrusted");
  assert.equal((await service.usable(context)).length, 0);
  await service.reset({ ...input, name: "developer", field: "enabled" });
  await assertTrust("untrusted");
  assert.equal(
    JSON.parse(await readFile(projectPath, "utf8")).profiles.explore
      .instructions,
    "Untouched imported instructions",
  );
  const configuration = await service.configuration(input);
  await service.trust(context.projectId, configuration.digest!);
  await service.update({
    ...input,
    name: "developer",
    patch: { enabled: true },
  });
  await assertTrust("trusted");
  await service.reset({ ...input, name: "developer", field: "enabled" });
  await assertTrust("trusted");
});

it("automatically trusts a new project document authored by Nerve", async () => {
  const { service } = await setup();
  const configuration = await service.update({
    scope: "project",
    projectId: context.projectId,
    name: "developer",
    expectedDigest: null,
    patch: { instructions: "Authored instructions" },
  });
  assert.equal(configuration.trust, "trusted");
  assert.equal((await service.find(context, "developer"))?.trust, "trusted");
});

it("rejects digest conflicts, preserves unrelated invalid entries and allows their reset", async () => {
  const { service, userPath, write } = await setup();
  await write(userPath, {
    developer: { permission: "unsafe" },
    explore: { enabled: true },
  });
  const configuration = await service.configuration({ scope: "user" });
  assert.ok(
    configuration.profiles
      .find((profile) => profile.name === "developer")
      ?.diagnostics.some((item) => item.code === "invalid_entry"),
  );
  assert.ok(
    (await service.usable(context)).some(
      (profile) => profile.name === "explore",
    ),
  );
  assert.ok(
    !(await service.usable(context)).some(
      (profile) => profile.name === "developer",
    ),
  );
  await assert.rejects(
    service.update({
      scope: "user",
      name: "explore",
      expectedDigest: null,
      patch: { enabled: false },
    }),
    /changed/,
  );
  await service.update({
    scope: "user",
    name: "explore",
    expectedDigest: configuration.digest,
    patch: { enabled: false },
  });
  assert.deepEqual(
    JSON.parse(await readFile(userPath, "utf8")).profiles.developer,
    { permission: "unsafe" },
  );
  await service.reset({ scope: "user", name: "developer" });
  assert.ok(
    (await service.usable(context)).some(
      (profile) => profile.name === "developer",
    ),
  );
});

it("diagnoses legacy enabled-only JSON as migration-needed without loading or rewriting it", async () => {
  const { service, userPath } = await setup();
  const content = '{"enabled":{"explore":true}}';
  await mkdir(join(userPath, ".."), { recursive: true });
  await writeFile(userPath, content);
  const result = await service.configuration({ scope: "user" });
  assert.equal(result.document, null);
  const diagnostic = result.diagnostics.find(
    (item) => item.code === "invalid_document",
  );
  assert.equal(diagnostic?.severity, "blocking");
  assert.match(
    diagnostic?.message ?? "",
    /Legacy subagents\.json requires storage migration/,
  );
  assert.match(diagnostic?.message ?? "", /Back up.*migration status/);
  assert.doesNotMatch(
    diagnostic?.message ?? "",
    /invalid_type|invalid_value|"path"/,
  );
  assert.ok((diagnostic?.message.length ?? Infinity) < 250);
  assert.equal((await service.usable(context)).length, 0);
  await assert.rejects(
    service.update({
      scope: "user",
      name: "explore",
      patch: { enabled: true },
    }),
    /requires storage migration/,
  );
  await assert.rejects(
    service.reset({ scope: "user", name: "explore" }),
    /requires storage migration/,
  );
  assert.equal(await readFile(userPath, "utf8"), content);
});

it("shows malformed/unreadable document errors and refuses to overwrite them", async () => {
  const { service, userPath } = await setup();
  await mkdir(join(userPath, ".."), { recursive: true });
  for (const content of [
    "{",
    "null",
    '{"schemaVersion":9,"profiles":{}}',
    '{"schemaVersion":1,"profiles":null}',
    '{"schemaVersion":1,"profiles":{"Invalid Name":{}}}',
    '{"schemaVersion":1,"profiles":{},"unexpected":true}',
    "[]",
    "true",
  ]) {
    await writeFile(userPath, content);
    const result = await service.configuration({ scope: "user" });
    assert.equal(result.document, null);
    const diagnostic = result.diagnostics.find(
      (item) => item.code === "invalid_document",
    );
    assert.ok(diagnostic);
    assert.match(diagnostic.message, /subagents\.json/);
    assert.match(diagnostic.message, /has not been changed/);
    assert.doesNotMatch(
      diagnostic.message,
      /invalid_type|invalid_value|"path"/,
    );
    assert.ok(diagnostic.message.length < 250);
    await assert.rejects(
      service.update({
        scope: "user",
        name: "developer",
        patch: { enabled: true },
      }),
    );
    assert.equal(await readFile(userPath, "utf8"), content);
  }
  await rm(userPath);
  await mkdir(userPath);
  assert.ok(
    (await service.configuration({ scope: "user" })).diagnostics.length,
  );
  await assert.rejects(service.reset({ scope: "user", name: "developer" }));
});

it("rechecks availability, keeps portable references and leaves warning-only profiles usable", async () => {
  const { service, userPath, setDiagnostics } = await setup();
  await service.update({
    scope: "user",
    name: "developer",
    patch: { tools: { future_tool: true }, skills: { missing: true } },
  });
  setDiagnostics([
    {
      severity: "warning",
      code: "missing_tool",
      reference: "future_tool",
      message: "Not installed",
    },
  ]);
  assert.ok(
    (await service.usable(context)).some(
      (profile) => profile.name === "developer",
    ),
  );
  for (const input of [
    { scope: "user" as const },
    { scope: "project" as const, projectId: context.projectId },
  ]) {
    assert.ok(
      (await service.configuration(input)).profiles
        .find((item) => item.name === "developer")
        ?.diagnostics.some((item) => item.code === "missing_tool"),
    );
  }
  const config = await service.configuration({
    scope: "conversation",
    ...context,
  });
  assert.ok(
    config.profiles
      .find((item) => item.name === "developer")
      ?.diagnostics.some((item) => item.code === "missing_tool"),
  );
  setDiagnostics([
    {
      severity: "blocking",
      code: "missing_model",
      message: "Configure provider",
    },
  ]);
  assert.equal((await service.usable(context)).length, 0);
  assert.deepEqual(
    JSON.parse(await readFile(userPath, "utf8")).profiles.developer.tools,
    { future_tool: true },
  );
  setDiagnostics([]);
  assert.ok((await service.usable(context)).length);
});

it("forwards captured parent configuration to availability without changing public reads", async () => {
  const captured: ConversationConfig = {
    conversationId: context.conversationId,
    model: { provider: "captured", modelId: "supported" },
    reasoningLevel: "high",
    systemPrompt: null,
    instructions: null,
    permissionRuleSetId: "baseline",
    mode: "coding",
    workingDirectory: "/project",
  };
  const received: Array<ConversationConfig | undefined> = [];
  const { service } = await setup(async (_profile, availabilityContext) => {
    received.push(availabilityContext.parentConfig);
    return availabilityContext.parentConfig === captured
      ? []
      : [
          {
            severity: "blocking",
            code: "live_parent_unavailable",
            message: "The live parent uses a different unavailable model.",
          },
        ];
  });
  const snapshotContext = { ...context, parentConfig: captured };
  assert.equal(
    (await service.find(snapshotContext, "developer"))?.error,
    undefined,
  );
  assert.ok((await service.usable(snapshotContext)).length);
  assert.ok(received.every((config) => config === captured));
  received.length = 0;
  assert.match(
    (await service.find(context, "developer"))?.error ?? "",
    /live parent/,
  );
  assert.ok(received.every((config) => config === undefined));
});

it("serializes optimistic mutations and preserves pinned map selections", async () => {
  const { service, userPath } = await setup();
  await service.update({
    scope: "user",
    name: "developer",
    patch: { tools: { future_tool: true }, skills: { portable: true } },
  });
  const configuration = await service.configuration({ scope: "user" });
  const input = {
    scope: "user" as const,
    name: "developer",
    expectedDigest: configuration.digest,
  };
  const results = await Promise.allSettled([
    service.update({ ...input, patch: { thinking: "lead" } }),
    service.update({ ...input, patch: { enabled: false } }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  await service.update({
    scope: "user",
    name: "developer",
    patch: {
      tools: { future_tool: null, another: false },
      skills: { portable: null },
    },
  });
  const entry = JSON.parse(await readFile(userPath, "utf8")).profiles.developer;
  assert.equal(entry.thinking, "lead");
  assert.deepEqual(entry.tools, { another: false });
  assert.deepEqual(entry.skills, {});
  await service.update({
    scope: "user",
    name: "constructor",
    patch: { enabled: true },
  });
  assert.deepEqual(
    JSON.parse(await readFile(userPath, "utf8")).profiles.constructor,
    { enabled: true },
  );
});

it("protects ownership and rejects symlinked scope directories before creating files", async () => {
  const { service, root, project } = await setup();
  await assert.rejects(
    service.configuration({
      scope: "conversation",
      ...context,
      projectId: "proj_other",
    }),
    /belong/,
  );
  await assert.rejects(
    service.update({
      scope: "conversation",
      ...context,
      conversationId: "../escape",
      name: "developer",
      patch: { enabled: true },
    }),
    /Invalid conversation/,
  );
  const outside = join(root, "outside");
  await mkdir(outside);
  await symlink(outside, join(project, ".nerve"));
  await assert.rejects(
    service.update({
      scope: "project",
      projectId: context.projectId,
      name: "developer",
      patch: { enabled: true },
    }),
    /symbolic links/,
  );
  await assert.rejects(
    readFile(join(outside, "config", "subagents.json")),
    /ENOENT/,
  );
});
