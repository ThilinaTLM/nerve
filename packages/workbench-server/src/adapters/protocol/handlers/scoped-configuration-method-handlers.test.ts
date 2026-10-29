import type { z } from "zod";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  scopedProfileOperationDefinitions,
  leadConversationAgentSchema,
  type ProfileDefinition,
} from "@nervekit/contracts/agent-configuration";
import { AgentConfigurationService } from "../../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { digestBytes } from "../../../infrastructure/configuration/scoped-store/scoped-document-store.js";
import { scopedConfigurationMethodHandlers } from "./scoped-configuration-method-handlers.js";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";

type Context = ServerAdapterContexts["protocol"]["platform"];
const user = { scope: "user" as const };
const project = { scope: "project" as const, projectId: "p" };
const definition: ProfileDefinition = {
  schemaVersion: 1,
  name: "coding",
  whenToUse: "Coding",
  instructions: "Short coding instructions",
  usableBy: "both",
  recommendations: {},
  requirements: {},
};
function success<T extends { status: string }>(
  result: T,
): Extract<T, { status: "available" | "ready" | "saved" }> {
  assert.ok(
    ["available", "ready", "saved"].includes(result.status),
    JSON.stringify(result),
  );
  return result as Extract<T, { status: "available" | "ready" | "saved" }>;
}
function confirmationFor(
  preview: import("@nervekit/contracts/agent-configuration").RepairPreview,
) {
  return {
    target: preview.target,
    sourceDigest: preview.sourceDigest,
    candidateDigest: preview.candidateDigest,
    candidateVersion: preview.candidateVersion,
    candidate: preview.candidate,
    ...(preview.targetProfile ? { targetProfile: preview.targetProfile } : {}),
  };
}
async function fixture(t: TestContext) {
  const home = await mkdtemp(path.join(tmpdir(), "nerve-scoped-handlers-"));
  const directory = path.join(home, "project");
  await mkdir(directory);
  await mkdir(path.join(home, "config"));
  const decisions = new Map<
    string,
    { status: string; contentDigest: string }
  >();
  const key = (kind: string, projectId: string, file: string) =>
    JSON.stringify([kind, projectId, file]);
  const trusted = (
    kind: string,
    projectId: string,
    file: string,
    digest: string,
  ) => {
    const decision = decisions.get(key(kind, projectId, file));
    return decision?.status === "trusted" && decision.contentDigest === digest;
  };
  const service = new AgentConfigurationService({
    home,
    projectDirectory: () => directory,
    conversationOwner: () => ({ projectId: "p", role: "lead" }),
    builtins: { coding: JSON.stringify(definition) },
    isProfileTrusted: (id, file, digest) =>
      trusted("agent_profile", id, file, digest),
    isProjectAgentTrusted: (id, file, digest) =>
      trusted("project_capabilities", id, file, digest),
    captureResources: () => ({
      options: { referenceAvailable: () => true },
      isCurrent: () => true,
    }),
  });
  const state = {
    agentConfiguration: service,
    admissionPolicy: { invalidate() {} },
    conversationCore: {
      trust: {
        decide(input: {
          kind: string;
          projectId: string;
          path: string;
          status: string;
          contentDigest: string;
        }) {
          decisions.set(key(input.kind, input.projectId, input.path), input);
        },
      },
      retryConfigurationBlocked: async () => {},
      reconcilePlanReviews: async () => {},
    },
  } as unknown as Context;
  type Operation = (typeof scopedProfileOperationDefinitions)[number];
  type Result<M extends Operation["method"]> = z.output<
    Extract<Operation, { method: M }>["resultSchema"]
  >;
  async function invoke<M extends Operation["method"]>(
    method: M,
    params: unknown,
  ): Promise<Result<M>> {
    const operation = scopedProfileOperationDefinitions.find(
      (entry) => entry.method === method,
    )!;
    const handlers = scopedConfigurationMethodHandlers as unknown as Record<
      string,
      (context: Context, input: unknown) => unknown
    >;
    return operation.resultSchema.parse(
      await handlers[method](state, operation.paramsSchema.parse(params)),
    ) as Result<M>;
  }
  t.after(async () => {
    await service.flushSummaries();
    await rm(home, { recursive: true, force: true });
  });
  return { home, service, invoke, decisions };
}

void test("profile handlers edit complete v1 copies, expose provenance, enforce digest CAS and delete only the local shadow", async (t) => {
  const f = await fixture(t);
  const initial = success(
    await f.invoke("agentProfiles.read", {
      scope: user,
      name: "coding",
    }),
  );
  assert.ok(initial.profile.definition);
  assert.equal(initial.profile.source, "builtin");
  assert.equal(initial.localDigest, "missing");
  assert.equal(
    initial.profile.definition.instructions,
    definition.instructions,
  );
  const userCopy = success(
    await f.invoke("agentProfiles.save", {
      scope: user,
      name: "coding",
      expectedDigest: "missing",
      definition: { ...definition, instructions: "User instructions" },
    }),
  );
  assert.equal(userCopy.status, "saved");
  const inherited = success(
    await f.invoke("agentProfiles.read", {
      scope: project,
      name: "coding",
    }),
  );
  assert.equal(inherited.profile.source, "user");
  assert.equal(inherited.profile.local, false);
  assert.equal(inherited.localDigest, "missing");
  const copy = success(
    await f.invoke("agentProfiles.save", {
      scope: project,
      name: "coding",
      expectedDigest: "missing",
      definition: {
        ...definition,
        instructions: "Project instructions",
        enabled: false,
      },
    }),
  );
  const local = success(
    await f.invoke("agentProfiles.read", {
      scope: project,
      name: "coding",
    }),
  );
  assert.equal(local.profile.source, "project");
  assert.equal(local.profile.local, true);
  assert.equal(local.profile.enabled, false);
  assert.equal(local.profile.trusted, false);
  assert.equal(
    (await f.service.profiles.get("coding", "p")).status,
    "unavailable",
  );
  assert.equal(
    (
      await f.invoke("agentProfiles.save", {
        scope: project,
        name: "coding",
        expectedDigest: "missing",
        definition,
      })
    ).status,
    "conflict",
  );
  assert.equal(
    (
      await f.invoke("agentProfiles.delete", {
        scope: project,
        name: "coding",
        expectedDigest: userCopy.digest,
      })
    ).status,
    "conflict",
  );
  assert.equal(
    (
      await f.invoke("agentProfiles.reset", {
        scope: project,
        name: "coding",
        expectedDigest: copy.digest,
      })
    ).status,
    "saved",
  );
  const revealed = success(
    await f.invoke("agentProfiles.read", {
      scope: project,
      name: "coding",
    }),
  );
  assert.ok(revealed.profile.definition);
  assert.equal(revealed.profile.source, "user");
  assert.equal(revealed.profile.definition.instructions, "User instructions");
  assert.equal(
    (await f.invoke("agentProfiles.list", { scope: project })).profiles.length,
    1,
  );
});

void test("project profile and agent trust/revoke bind exact bytes and repair never grants trust", async (t) => {
  const f = await fixture(t);
  const saved = success(
    await f.invoke("agentProfiles.save", {
      scope: project,
      name: "coding",
      expectedDigest: "missing",
      definition,
    }),
  );
  const target = { document: "profile", scope: project, name: "coding" };
  assert.equal(
    (
      await f.invoke("agentProfiles.trust", {
        target,
        expectedDigest: "wrong",
        trusted: true,
      })
    ).status,
    "conflict",
  );
  assert.equal(
    success(
      await f.invoke("agentProfiles.trust", {
        target,
        expectedDigest: saved.digest,
        trusted: true,
      }),
    ).trusted,
    true,
  );
  assert.equal(
    (await f.service.profiles.get("coding", "p")).status,
    "available",
  );
  assert.equal(
    success(
      await f.invoke("agentProfiles.trust", {
        target,
        expectedDigest: saved.digest,
        trusted: false,
      }),
    ).trusted,
    false,
  );
  assert.equal(
    (await f.service.profiles.get("coding", "p")).status,
    "unavailable",
  );
  const file = f.service.paths.agent(project);
  await mkdir(path.dirname(file), { recursive: true });
  const bytes = JSON.stringify({
    schemaVersion: 1,
    revision: 1,
    overrides: { permissionRuleSetId: "read_only" },
  });
  await writeFile(file, bytes);
  assert.equal(
    (
      await f.invoke("agentConfiguration.trust", {
        target: { document: "agent", scope: project },
        expectedDigest: digestBytes(bytes),
        trusted: true,
      })
    ).status,
    "saved",
  );
  assert.equal(f.decisions.size, 2);
  await writeFile(
    f.service.paths.agent(user),
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      overrides: { permissionRuleSetId: "read_only" },
    }),
  );
  await f.service.reload(user);
  const preview = success(
    await f.invoke("agentConfiguration.repairPreview", {
      target: { document: "agent", scope: project },
      replacement: {
        schemaVersion: 1,
        revision: 1,
        overrides: { permissionRuleSetId: "autonomous" },
      },
    }),
  );
  assert.equal(
    preview.preview.resolution?.settings.permissionRuleSetId,
    "read_only",
  );
  assert.equal(
    preview.preview.resolution?.provenance["/permissionRuleSetId"].source,
    "user",
  );
  const confirmation = confirmationFor(preview.preview);
  const applied = success(
    await f.invoke("agentConfiguration.repairApply", confirmation),
  );
  assert.equal(applied.status, "saved");
  assert.notEqual(applied.digest, digestBytes(bytes));
  const decision = [...f.decisions.values()].find(
    (entry) => entry.contentDigest === digestBytes(bytes),
  )!;
  assert.equal(decision.contentDigest, digestBytes(bytes));
});

void test("repair preview has no writes; apply is source/candidate bound, backs up exact originals, and receipt retry never rewrites", async (t) => {
  const f = await fixture(t);
  const file = f.service.paths.agent(user);
  const original =
    '{"schemaVersion":1,"revision":2,"overrides":{},"unknown":"do-not-log"}';
  await writeFile(file, original);
  await f.service.reload(user);
  const target = { document: "agent", scope: user };
  const preview = success(
    await f.invoke("agentConfiguration.repairPreview", {
      target,
      replacement: { schemaVersion: 1, revision: 0, overrides: {} },
    }),
  );
  assert.equal(preview.status, "ready");
  assert.ok(preview.preview.changedPaths.includes("/unknown"));
  assert.equal(await readFile(file, "utf8"), original);
  await assert.rejects(stat(path.join(f.home, "quarantine", "settings")), {
    code: "ENOENT",
  });
  const confirmation = confirmationFor(preview.preview);
  assert.equal(
    (
      await f.invoke("agentConfiguration.repairApply", {
        ...confirmation,
        candidateDigest: "wrong",
      })
    ).status,
    "conflict",
  );
  const saved = success(
    await f.invoke("agentConfiguration.repairApply", confirmation),
  );
  assert.equal(saved.status, "saved");
  assert.ok(saved.backupPath);
  assert.equal(await readFile(saved.backupPath, "utf8"), original);
  assert.equal((await stat(saved.backupPath)).mode & 0o777, 0o600);
  assert.ok(
    !(await readFile(saved.receiptPath, "utf8")).includes("do-not-log"),
  );
  const after = await readFile(file, "utf8");
  const again = success(
    await f.invoke("agentConfiguration.repairApply", confirmation),
  );
  assert.equal(again.receiptPath, saved.receiptPath);
  assert.equal(await readFile(file, "utf8"), after);
  await writeFile(file, after + " ");
  assert.equal(
    (await f.invoke("agentConfiguration.repairApply", confirmation)).status,
    "conflict",
  );
  assert.equal(await readFile(file, "utf8"), after + " ");
});

void test("repair cannot forge an applied snapshot; missing conversation recovery requires a current validated profile target", async (t) => {
  const f = await fixture(t);
  const scope = { scope: "conversation", conversationId: "c" };
  const replacement = {
    schemaVersion: 1,
    revision: 1,
    appliedProfile: null,
    overrides: {},
  };
  const input = { target: { document: "agent", scope }, replacement };
  assert.equal(
    (await f.invoke("agentConfiguration.repairPreview", input)).status,
    "invalid",
  );
  const selected = success(
    await f.invoke("agentProfiles.read", {
      scope: user,
      name: "coding",
    }),
  );
  const preview = success(
    await f.invoke("agentConfiguration.repairPreview", {
      ...input,
      targetProfile: { name: "coding", digest: selected.profile.digest },
    }),
  );
  assert.equal(preview.status, "ready");
  assert.equal(
    leadConversationAgentSchema.parse(preview.preview.candidate).appliedProfile
      ?.instructions,
    definition.instructions,
  );
  const confirmation = confirmationFor(preview.preview);
  assert.equal(
    (await f.invoke("agentConfiguration.repairApply", confirmation)).status,
    "saved",
  );
  assert.equal((await f.service.getEffective("c")).status, "available");
  const file = f.service.paths.agent({
    scope: "conversation",
    conversationId: "c",
  });
  const document = {
    ...JSON.parse(await readFile(file, "utf8")),
    lastTransition: { id: "old-approval", kind: "plan-approval" },
  };
  await writeFile(file, JSON.stringify(document));
  await f.service.reload({ scope: "conversation", conversationId: "c" });
  const repair = success(
    await f.invoke("agentConfiguration.repairPreview", {
      target: input.target,
      replacement: document,
    }),
  );
  assert.equal(
    leadConversationAgentSchema.parse(repair.preview.candidate).lastTransition,
    undefined,
  );
  assert.equal(
    (
      await f.invoke(
        "agentConfiguration.repairApply",
        confirmationFor(repair.preview),
      )
    ).status,
    "saved",
  );
  assert.equal(
    JSON.parse(await readFile(file, "utf8")).lastTransition,
    undefined,
  );
});

void test("CAS conflict authoritatively reloads agent/profile scopes and explicit Reload activates manual fixes", async (t) => {
  const f = await fixture(t);
  const { agentConfigurationOperations } =
    await import("../../../infrastructure/configuration/agent-configuration/scoped-configuration-operations.js");
  const operations = agentConfigurationOperations(f.service);
  const notices: unknown[] = [];
  f.service.subscribeHealth((scope) => notices.push(scope));
  const cached = await operations.get(project);
  assert.equal(cached.status, "available");
  const file = f.service.paths.agent(project);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "broken");
  assert.equal(
    (await operations.get(project)).status,
    "available",
    "ordinary reads do not poll disk",
  );
  const count = notices.length;
  assert.equal(
    (
      await operations.save({
        scope: project,
        expectedRevision: 0,
        expectedDigest: "missing",
        changes: {},
        resets: [],
      })
    ).status,
    "conflict",
  );
  assert.equal((await operations.get(project)).status, "unavailable");
  assert.ok(notices.length > count);
  assert.ok(f.service.health().some((issue) => issue.path === file));
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: 1,
      revision: 7,
      overrides: { reasoningLevel: "off" },
    }),
  );
  assert.equal((await operations.get(project)).status, "unavailable");
  const reloaded = await f.invoke("agentConfiguration.reload", {
    target: { document: "agent", scope: project },
  });
  assert.equal(reloaded.status, "reloaded");
  const fresh = await operations.get(project);
  assert.equal(fresh.status, "available");
  if (fresh.status === "available") assert.equal(fresh.source.revision, 7);
  assert.equal(
    f.service.health().some((issue) => issue.path === file),
    false,
  );
  const saved = success(
    await f.invoke("agentProfiles.save", {
      scope: user,
      name: "coding",
      expectedDigest: "missing",
      definition,
    }),
  );
  await writeFile(f.service.paths.profile(user, "coding"), "bad profile");
  assert.equal(
    (
      await f.invoke("agentProfiles.save", {
        scope: user,
        name: "coding",
        expectedDigest: saved.digest,
        definition,
      })
    ).status,
    "conflict",
  );
  const profile = success(
    await f.invoke("agentProfiles.read", { scope: user, name: "coding" }),
  );
  assert.equal(profile.profile.definition, null);
  assert.ok(profile.profile.diagnostics.length > 0);
});
