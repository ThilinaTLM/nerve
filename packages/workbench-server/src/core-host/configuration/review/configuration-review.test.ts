import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { ConfigurationReviewTarget } from "@nervekit/contracts/configuration";
import type { TrustedResource } from "@nervekit/contracts/core";
import {
  TrustedResourceService,
  type CoreStorage,
} from "@nervekit/conversation-core";
import type { Skill } from "@nervekit/harness/resources";
import {
  ConfigurationReviewService,
  type ConfigurationReviewPorts,
} from "./configuration-review.js";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "nerve-review-"));
});
afterEach(() => rm(home, { recursive: true, force: true }));

/** The real service over an in-memory table. */
function memoryTrust() {
  const rows = new Map<string, TrustedResource>();
  const key = (kind: string, projectId: string | null, resourceKey: string) =>
    `${kind}|${projectId}|${resourceKey}`;
  const storage = {
    trustedResources: {
      list: () => [...rows.values()],
      find: (kind: string, projectId: string | null, resourceKey: string) =>
        rows.get(key(kind, projectId, resourceKey)) ?? null,
      insert: (row: TrustedResource) => {
        rows.set(key(row.kind, row.projectId, row.resourceKey), row);
        return row;
      },
      update: (id: string, patch: Partial<TrustedResource>) => {
        const [k, row] = [...rows].find(([, entry]) => entry.id === id)!;
        const next = { ...row, ...patch };
        rows.set(k, next);
        return next;
      },
    },
  } as unknown as CoreStorage;
  return new TrustedResourceService(storage, () => new Date().toISOString());
}

function setup(overrides: Partial<ConfigurationReviewPorts> = {}) {
  const trust = memoryTrust();
  const decided: string[] = [];
  const service = new ConfigurationReviewService({
    home,
    trust,
    projectDirectory: () => undefined,
    agentPaths: {
      agent: () => join(home, "config", "agent.json"),
      profile: (_scope, name) =>
        join(home, "agent", "agent-profiles", `${name}.json`),
    },
    skills: async () => ({
      user: { skills: [] },
      project: { skills: [] },
    }),
    suggestions: { listStatuses: async () => [] },
    extensions: {
      entries: async () => [],
      grantConsent: async () => "not_found",
      reload: async () => undefined,
    },
    mcp: {
      review: async () => null,
      checkDecision: async () => {
        throw new Error("unexpected");
      },
    },
    profileRuleSetId: async () => undefined,
    decided: async (target) => void decided.push(target.kind),
    ...overrides,
  });
  return { service, trust, decided };
}

const ruleSetFile = (rules: unknown[]) =>
  JSON.stringify({
    schemaVersion: 1,
    id: "mine",
    name: "Mine",
    source: "user",
    enabled: true,
    rules,
  });
const allowAll = {
  id: "all",
  enabled: true,
  priority: 0,
  enforcement: "overridable",
  when: {},
  decision: "allow",
};
const allowTest = {
  id: "test",
  enabled: true,
  priority: 1,
  enforcement: "overridable",
  when: {
    toolNames: ["bash"],
    primaryArgument: { operator: "equals", value: "pnpm test" },
  },
  decision: "allow",
};
const target: ConfigurationReviewTarget = {
  kind: "rule-set",
  scope: "user",
  id: "mine",
};
async function writeRuleSet(rules: unknown[]) {
  await mkdir(join(home, "config", "rule-sets"), { recursive: true });
  await writeFile(
    join(home, "config", "rule-sets", "mine.json"),
    ruleSetFile(rules),
  );
}

void test("a user rule set waits for review with its sources, then a decision records the items it was approved on", async () => {
  await writeRuleSet([allowTest]);
  const { service, trust, decided } = setup();
  const first = await service.review(target);
  assert.equal(first.state, "needs_review");
  assert.equal(first.kindLabel, "Permission rule set");
  assert.equal(first.changedSinceDecision, false);
  assert.deepEqual(first.sources.map((entry) => entry.label).length, 1);
  assert.ok(first.sources[0].bytes! > 0);
  assert.ok(first.changedAt);
  assert.ok(first.items.every((entry) => !entry.new));

  const trusted = await service.decide({
    target,
    digest: first.digest,
    trusted: true,
  });
  assert.equal(trusted.state, "trusted");
  assert.deepEqual(decided, ["rule-set"]);
  const row = trust.find(
    "permission_rule_set",
    null,
    join(home, "config", "rule-sets", "mine.json"),
  );
  assert.equal(row?.status, "trusted");
  assert.deepEqual(row?.grants, {
    items: ["Allows `pnpm test` without asking"],
  });

  // Changed outside Nerve: needs review again, and only the added broad rule is new.
  await writeRuleSet([allowTest, allowAll]);
  const changed = await service.review(target);
  assert.equal(changed.state, "needs_review");
  assert.equal(changed.changedSinceDecision, true);
  assert.deepEqual(
    changed.items.map((entry) => [entry.short, entry.broad, entry.new]),
    [
      ["Allows every call", true, true],
      ["Allows pnpm test", false, false],
    ],
  );
});

void test("a decision on a stale digest is refused and records nothing", async () => {
  await writeRuleSet([allowTest]);
  const { service, trust } = setup();
  const reviewed = await service.review(target);
  await writeRuleSet([allowAll]);
  await assert.rejects(
    service.decide({ target, digest: reviewed.digest, trusted: true }),
    /changed since you reviewed it/,
  );
  assert.deepEqual(trust.list(null), []);
});

void test("declining records a rejection that stays whatever the content becomes", async () => {
  await writeRuleSet([allowTest]);
  const { service } = setup();
  const reviewed = await service.review(target);
  const declined = await service.decide({
    target,
    digest: reviewed.digest,
    trusted: false,
  });
  assert.equal(declined.state, "declined");
  await writeRuleSet([allowAll]);
  assert.equal((await service.review(target)).state, "declined");
});

void test("a skill's review lists every file, flags scripts and digests the folder", async () => {
  const folder = join(home, "agent", "skills", "notes");
  await mkdir(join(folder, "scripts"), { recursive: true });
  await writeFile(join(folder, "SKILL.md"), "---\nname: notes\n---\n");
  await writeFile(join(folder, "scripts", "run.sh"), "echo hi\n");
  const skill = {
    name: "notes",
    description: "Notes",
    filePath: join(folder, "SKILL.md"),
  } as unknown as Skill;
  const { service } = setup({
    skills: async () => ({
      user: { skills: [skill] },
      project: { skills: [] },
    }),
  });
  const skillTarget: ConfigurationReviewTarget = {
    kind: "skill",
    scope: "user",
    id: "notes",
  };
  const review = await service.review(skillTarget);
  assert.deepEqual(
    review.sources.map((entry) => [entry.label, entry.script ?? false]),
    [
      ["SKILL.md", false],
      ["scripts/run.sh", true],
    ],
  );
  assert.equal(review.items[0]?.broad, true);
  assert.match(review.digest, /^sha256:/);
  await service.decide({
    target: skillTarget,
    digest: review.digest,
    trusted: true,
  });
  assert.equal((await service.review(skillTarget)).state, "trusted");
  await writeFile(join(folder, "scripts", "run.sh"), "echo changed\n");
  assert.equal((await service.review(skillTarget)).state, "needs_review");
});

void test("launch catalogs are not reviewable, and a project item needs its project", async () => {
  const { service } = setup();
  await assert.rejects(
    service.review({
      kind: "launch-catalog",
      scope: "user",
      id: "launch.json",
    }),
    /not something that needs your approval/,
  );
  await assert.rejects(
    service.review({
      kind: "permission-overlay",
      scope: "project",
      id: "permissions.json",
    }),
    /needs the project/,
  );
  await assert.rejects(
    service.review(target),
    /There is no permission rule set "mine"/,
  );
});

void test("an invalid file cannot be reviewed", async () => {
  await mkdir(join(home, "config", "rule-sets"), { recursive: true });
  await writeFile(join(home, "config", "rule-sets", "mine.json"), "{ nope");
  const { service } = setup();
  await assert.rejects(
    service.review(target),
    /has problems and cannot be reviewed/,
  );
});

void test("an MCP decision takes its grants from the server's own review and refuses a changed entry", async () => {
  const grants = {
    transport: "stdio" as const,
    command: "npx",
    args: ["-y", "@linear/mcp"],
    env: [{ name: "PATH", value: "x", changesExecution: true }],
    references: [
      {
        kind: "secret" as const,
        name: "LINEAR",
        field: "env" as const,
        key: "LINEAR_API_KEY",
      },
    ],
  };
  let digest = `sha256:${"a".repeat(64)}`;
  const { service, trust } = setup({
    mcp: {
      review: async () => ({
        name: "linear",
        scope: "user",
        status: "needs_review",
        digest,
        grants,
        sends: [],
      }),
      checkDecision: async (input) => {
        if (input.contentDigest !== digest) throw new Error("changed");
        return grants;
      },
    },
  });
  const mcpTarget: ConfigurationReviewTarget = {
    kind: "mcp-servers",
    scope: "user",
    id: "linear",
  };
  const review = await service.review(mcpTarget);
  assert.equal(review.kindLabel, "MCP server");
  assert.equal(review.items[0]?.broad, true);
  assert.ok(review.items.some((entry) => entry.text.includes("`LINEAR`")));
  await service.decide({ target: mcpTarget, digest, trusted: true });
  const row = trust.find("mcp_server", null, "linear");
  assert.equal(row?.status, "trusted");
  assert.deepEqual(row?.grants, grants);
  digest = `sha256:${"b".repeat(64)}`;
  await assert.rejects(
    service.decide({
      target: mcpTarget,
      digest: `sha256:${"a".repeat(64)}`,
      trusted: true,
    }),
    /changed since you reviewed it/,
  );
});
