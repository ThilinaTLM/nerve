import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TrustedResource } from "@nervekit/contracts/core";
import {
  TrustedResourceService,
  type CoreStorage,
} from "@nervekit/conversation-core";
import type { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import { createExecutionAdmission } from "./execution-admission/admission.js";
import { overlayDigest } from "./permission-overlays.js";
import { createScopedPermissionSource } from "./scoped-permission-source.js";

const rule = (id: string, decision: "allow" | "deny") => ({
  id,
  enabled: true,
  priority: 1,
  enforcement: "overridable",
  when: { baseRisks: ["write"] },
  decision,
});
const overlay = (decision: "allow" | "deny") =>
  JSON.stringify({
    schemaVersion: 2,
    overlays: [{ ruleSetId: "supervised", rules: [rule("mine", decision)] }],
  });

async function fixture(selection = "supervised") {
  const home = await mkdtemp(join(tmpdir(), "nerve-policy-trust-"));
  await mkdir(join(home, "config", "rule-sets"), { recursive: true });
  const rows: TrustedResource[] = [];
  let ids = 0;
  const storage = {
    conversations: {
      get: (id: string) => ({ id, projectId: "p", parentConversationId: null }),
    },
    projects: { get: () => ({ id: "p", directory: home }) },
    trustedResources: {
      find: (kind: string, projectId: string | null, key: string) =>
        rows.find(
          (row) =>
            row.kind === kind &&
            row.projectId === projectId &&
            row.resourceKey === key,
        ) ?? null,
      insert: (row: TrustedResource) => rows.push(row) && row,
      update: (id: string, patch: Partial<TrustedResource>) =>
        Object.assign(rows.find((row) => row.id === id)!, patch),
    },
  } as unknown as CoreStorage;
  const trust = new TrustedResourceService(
    storage,
    () => "2026-11-26T00:00:00.000Z",
  );
  const agents = {
    async captureEffective() {
      return {
        view: {
          status: "available",
          resolution: { settings: { permissionRuleSetId: selection } },
          sources: [],
        },
        isCurrent: () => true,
      };
    },
  } as unknown as AgentConfigurationService;
  const start = () =>
    createScopedPermissionSource({
      projectMigration: new ProjectMigrationService({ home }),
      home,
      storage,
      trust,
      agents,
      trustGeneration: () => trust.generation,
      requestGenerations: () => undefined,
    });
  const input = {
    toolCallId: "call",
    conversationId: "c",
    projectDir: home,
    toolName: "write",
    origin: "model" as const,
    args: { path: "file.txt", content: "hello" },
    cwd: home,
    target: {},
    requestCaptureId: "capture",
  };
  const decide = (
    kind: "permissions" | "permission_rule_set",
    path: string,
    text: string,
    status: "trusted" | "rejected" = "trusted",
  ) =>
    trust.decide({
      kind,
      projectId: null,
      resourceKey: path,
      name: null,
      contentDigest: overlayDigest(text),
      status,
    });
  const decision = async (source: ReturnType<typeof start>) => {
    const check = (await createExecutionAdmission(source)(input)).check();
    return check.kind === "policy"
      ? check.supervision.decision
      : check.kind === "blocked"
        ? `blocked:${check.request.diagnostics[0].code}`
        : check.kind;
  };
  return { home, start, decide, decision, ids: () => ids++ };
}

void test("a user overlay changed outside Nerve keeps the last trusted version until it is trusted", async () => {
  const f = await fixture();
  const path = join(f.home, "config", "permissions.json");
  try {
    await writeFile(path, overlay("deny"));
    f.decide("permissions", path, overlay("deny"));
    const source = f.start();
    assert.equal(await f.decision(source), "deny");
    // A hand edit that loosens the rules does not apply, and the report says why.
    await writeFile(path, overlay("allow"));
    const [report] = await source.reload([path]);
    assert.equal(report.previousVersionActive, true);
    assert.equal(await f.decision(source), "deny");
    // Trusting exactly those bytes activates them without another reload.
    f.decide("permissions", path, overlay("allow"));
    assert.equal(await f.decision(source), "allow");
  } finally {
    await rm(f.home, { recursive: true, force: true });
  }
});

void test("after a restart an untrusted user overlay blocks the affected calls, and trusting it unblocks them", async () => {
  const f = await fixture();
  const path = join(f.home, "config", "permissions.json");
  try {
    await writeFile(path, overlay("allow"));
    const source = f.start();
    assert.equal(await f.decision(source), "blocked:needs-review");
    f.decide("permissions", path, overlay("allow"));
    assert.equal(await f.decision(source), "allow");
  } finally {
    await rm(f.home, { recursive: true, force: true });
  }
});

void test("a user rule set that waits is not selectable and blocks calls that select it", async () => {
  const f = await fixture("mine");
  const path = join(f.home, "config", "rule-sets", "mine.json");
  try {
    const text = JSON.stringify({
      schemaVersion: 1,
      id: "mine",
      name: "Mine",
      source: "user",
      enabled: true,
      rules: [{ ...rule("all", "allow"), when: {} }],
    });
    await writeFile(path, text);
    const source = f.start();
    assert.equal((await source.selectableRuleSetIds()).includes("mine"), false);
    assert.equal(await f.decision(source), "blocked:needs-review");
    f.decide("permission_rule_set", path, text);
    assert.equal((await source.selectableRuleSetIds()).includes("mine"), true);
  } finally {
    await rm(f.home, { recursive: true, force: true });
  }
});
