import assert from "node:assert/strict";
import { removeTree } from "@nervekit/test-kit";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CoreStorage } from "@nervekit/conversation-core";
import type { TrustedResource } from "@nervekit/contracts/core";
import { projectMigrationTrust } from "../../infrastructure/configuration/project-migration/project-migration-trust.js";
import {
  PromptSuggestionEnablementService,
  type ProjectSuggestionFileTrust,
} from "./prompt-suggestion-enablement.service.js";
import { PromptSuggestionService } from "./prompt-suggestion.service.js";

/** The runtime's trust wiring over an in-memory trusted-resource table. */
function memoryTrust() {
  const rows = new Map<string, TrustedResource>();
  const storage = {
    transaction: (fn: () => void) => fn(),
    trustedResources: {
      find: (_kind: string, _projectId: string, key: string) =>
        rows.get(key) ?? null,
      insert: (row: TrustedResource) => rows.set(row.resourceKey, row),
      update: (id: string, patch: Partial<TrustedResource>) => {
        for (const [key, row] of rows)
          if (row.id === id) rows.set(key, { ...row, ...patch });
      },
      delete: () => undefined,
    },
  } as unknown as CoreStorage;
  const carry = projectMigrationTrust(() => storage, {
    "prompt-suggestions": "capabilities",
  });
  const trust: ProjectSuggestionFileTrust = {
    state: (_projectId, path, digest) => {
      const row = rows.get(path);
      return !row
        ? "needs_review"
        : row.status === "rejected"
          ? "declined"
          : row.contentDigest === digest
            ? "trusted"
            : "needs_review";
    },
    decide: ({ projectId, path, digest, trusted }) =>
      rows.set(path, {
        id: `trust_${rows.size}`,
        kind: "capabilities",
        projectId,
        resourceKey: path,
        name: null,
        grants: null,
        contentDigest: digest,
        status: trusted ? "trusted" : "rejected",
        createdAt: "2026-11-22T00:00:00.000Z",
        updatedAt: "2026-11-22T00:00:00.000Z",
      }),
    capture: carry.capture,
  };
  return trust;
}

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const home = await mkdtemp(join(tmpdir(), "suggestion-enablement-"));
  t.after(() => removeTree(home));
  const config = join(home, "config");
  const dir = join(home, "project");
  await mkdir(config, { recursive: true });
  await mkdir(dir, { recursive: true });
  const enablement = new PromptSuggestionEnablementService(
    config,
    memoryTrust(),
  );
  const service = new PromptSuggestionService({
    storage: {
      paths: { home, suggestionsPath: join(home, "suggestions") },
    } as never,
    events: { publish: async () => undefined } as never,
    trustRepository: { list: () => [] } as never,
    enablementRepository: enablement,
    git: {} as never,
    getProject: (id) => ({ id, name: "P", dir }),
    listProjects: () => [{ id: "proj_a", name: "P", dir }],
    getConversation: () => {
      throw new Error("unused");
    },
  });
  const status = async (projectId?: string) => {
    const all = await service.listStatuses(projectId);
    const first = all.find((s) => s.sourceKind === "builtin")!;
    return first;
  };
  return { service, dir, status, enablement };
}

void test("suggestion enablement is project ?? user ?? default, and clearing inherits", async (t) => {
  const f = await fixture(t);
  const base = await f.status("proj_a");
  const key = base.definitionKey;
  const flipped = !base.defaultEnabled;
  assert.equal(base.enabled, base.defaultEnabled);
  assert.equal(base.userEnabled, undefined);
  assert.equal(base.projectEnabled, undefined);

  await f.service.updateEnabled({ definitionKey: key, enabled: flipped });
  let status = await f.status("proj_a");
  assert.deepEqual(
    [status.enabled, status.userEnabled, status.projectEnabled],
    [flipped, flipped, undefined],
  );

  // The project switches back what the user changed, in its own file.
  await f.service.updateEnabled({
    definitionKey: key,
    enabled: base.defaultEnabled,
    scope: "project",
    projectId: "proj_a",
  });
  status = await f.status("proj_a");
  assert.deepEqual(
    [status.enabled, status.userEnabled, status.projectEnabled],
    [base.defaultEnabled, flipped, base.defaultEnabled],
  );
  const file = JSON.parse(
    await readFile(
      join(f.dir, ".nerve/config/prompt-suggestions.json"),
      "utf8",
    ),
  );
  assert.deepEqual(file.enabled, { [key]: base.defaultEnabled });
  // User-level listing is unaffected by the project layer.
  assert.equal((await f.status()).enabled, flipped);

  await f.service.updateEnabled({
    definitionKey: key,
    enabled: null,
    scope: "project",
    projectId: "proj_a",
  });
  status = await f.status("proj_a");
  assert.deepEqual(
    [status.enabled, status.projectEnabled],
    [flipped, undefined],
  );
  await f.service.updateEnabled({ definitionKey: key, enabled: null });
  assert.equal((await f.status("proj_a")).enabled, base.defaultEnabled);
});

void test("a project file that needs review is ignored until its exact bytes are trusted", async (t) => {
  const f = await fixture(t);
  const base = await f.status("proj_a");
  const key = base.definitionKey;
  const flipped = !base.defaultEnabled;
  const path = join(f.dir, ".nerve/config/prompt-suggestions.json");
  await mkdir(join(f.dir, ".nerve/config"), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ version: 1, enabled: { [key]: flipped } }),
  );

  // A file the user did not write through Nerve is not applied.
  let file = await f.service.projectFile("proj_a");
  assert.equal(file.status, "needs_review");
  let status = await f.status("proj_a");
  assert.equal(status.projectEnabled, undefined);
  assert.equal(status.enabled, base.defaultEnabled);

  // Trust binds the exact bytes the user reviewed.
  assert.equal(
    await f.service.decideProjectFile({
      projectId: "proj_a",
      expectedDigest: "0".repeat(64),
      trusted: true,
    }),
    false,
  );
  assert.equal(
    await f.service.decideProjectFile({
      projectId: "proj_a",
      expectedDigest: file.digest!,
      trusted: true,
    }),
    true,
  );
  status = await f.status("proj_a");
  assert.deepEqual([status.projectEnabled, status.enabled], [flipped, flipped]);

  // A change made outside Nerve revokes the approval.
  await writeFile(
    path,
    JSON.stringify({ version: 1, enabled: { [key]: base.defaultEnabled } }),
  );
  file = await f.service.projectFile("proj_a");
  assert.equal(file.status, "needs_review");
  assert.equal((await f.status("proj_a")).projectEnabled, undefined);

  // Declining keeps it ignored.
  await f.service.decideProjectFile({
    projectId: "proj_a",
    expectedDigest: file.digest!,
    trusted: false,
  });
  assert.equal((await f.service.projectFile("proj_a")).status, "declined");
});

void test("edits made in the app keep the project file trusted; an untrusted file stays untrusted", async (t) => {
  const f = await fixture(t);
  const key = (await f.status("proj_a")).definitionKey;
  const write = (enabled: boolean | null) =>
    f.service.updateEnabled({
      definitionKey: key,
      enabled,
      scope: "project",
      projectId: "proj_a",
    });

  // Creating the file through the app trusts it, and so do later edits.
  await write(true);
  assert.equal((await f.service.projectFile("proj_a")).status, "trusted");
  await write(false);
  const file = await f.service.projectFile("proj_a");
  assert.equal(file.status, "trusted");
  assert.equal((await f.status("proj_a")).projectEnabled, false);

  // Bytes changed outside the app are not blessed by a later in-app edit.
  const path = join(f.dir, ".nerve/config/prompt-suggestions.json");
  await writeFile(
    path,
    JSON.stringify({ version: 1, enabled: { other: true } }),
  );
  await write(true);
  assert.equal((await f.service.projectFile("proj_a")).status, "needs_review");
  assert.equal((await f.status("proj_a")).projectEnabled, undefined);

  // A declined file stays declined through an edit in the app.
  const declined = await f.service.projectFile("proj_a");
  await f.service.decideProjectFile({
    projectId: "proj_a",
    expectedDigest: declined.digest!,
    trusted: false,
  });
  await write(false);
  assert.equal((await f.service.projectFile("proj_a")).status, "declined");
});
