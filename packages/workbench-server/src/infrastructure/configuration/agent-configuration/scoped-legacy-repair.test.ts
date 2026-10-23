import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReleasedProjectMigration } from "../../migrations/steps/0002-agent-profiles/released-project.js";
import {
  readText,
  writeProtected,
} from "../../migrations/steps/0002-agent-profiles/files.js";
import { AgentConfigurationService } from "./agent-configuration-service.js";
import { createScopedRepair } from "./scoped-repair.js";
import { agentConfigurationOperations } from "./scoped-configuration-operations.js";

const project = { scope: "project", projectId: "p" } as const;
const defaults = { schemaVersion: 1, revision: 0, overrides: {} };
function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = mkdtempSync(join(tmpdir(), "scoped-legacy-repair-")),
    home = join(root, "home");
  const put = (file: string, bytes: string) => {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, bytes);
  };
  const reports: string[] = [];
  const migration = new ReleasedProjectMigration({
    home,
    directory: (id) => join(root, id),
    io: {
      read: (file) => (existsSync(file) ? readText(file) : undefined),
      write: writeProtected,
      remove: (file) => rmSync(file),
    },
    discover: async () => ({}),
    originalTrust: () => [],
    commitTrust: () => {},
    report: (_, messages) => reports.push(...messages),
  });
  const service = new AgentConfigurationService({
    home,
    projectDirectory: (id) => join(root, id),
    conversationOwner: () => ({ projectId: "p", role: "lead" }),
    builtins: {},
    isProfileTrusted: () => false,
    prepareUser: () => migration.ensureUser(),
    retryUserMigration: () => migration.retryUser(),
    prepareProject: (id) => migration.ensure(id),
    retryProjectMigration: (id) => migration.retry(id),
    captureResources: () => ({ options: {}, isCurrent: () => true }),
  });
  t.after(async () => {
    await service.flushSummaries();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    home,
    put,
    service,
    reports,
    source: join(root, "p/.nerve/config/capabilities.json"),
    repair: createScopedRepair(service),
    operations: agentConfigurationOperations(service),
  };
}
await test("D12 project health isolates exact original; reset preview pins legacy source and confirmed reset protects backup", async (t) => {
  const f = fixture(t),
    original = ' {"schemaVersion":3,"tools":{}}\n';
  f.put(f.source, original);
  let notices = 0;
  f.service.subscribeHealth((scope) => {
    if (scope.scope === "project" && scope.projectId === "p") notices++;
  });
  await f.service.initialize();
  const state = await f.operations.get(project);
  assert.equal(state.status, "unavailable");
  assert.equal(state.diagnostics[0].path, f.source);
  await f.operations.get(project);
  assert.equal(
    notices,
    1,
    "cached failures must not cause health-notice reload loops",
  );
  assert.match(state.diagnostics[0].message!, /2/);
  assert.equal(
    (await f.operations.get({ scope: "project", projectId: "q" })).status,
    "available",
  );
  assert.equal(readFileSync(f.source, "utf8"), original);
  const preview = await f.repair.preview({
    target: { document: "agent", scope: project },
    replacement: defaults,
  });
  assert.equal(preview.candidate, null);
  assert.equal(
    preview.target.document === "agent" && preview.target.legacyFile,
    "capabilities",
  );
  assert.deepEqual(preview.changedPaths, [f.source]);
  assert.equal(readFileSync(f.source, "utf8"), original);
  const result = await f.repair.apply(preview);
  assert.equal(readFileSync(result.backupPath!, "utf8"), original);
  assert.equal(statSync(result.backupPath!).mode & 0o777, 0o600);
  assert.equal(existsSync(f.source), false);
  assert.equal((await f.operations.get(project)).status, "available");
  assert.deepEqual(await f.repair.apply(preview), result);
});
await test("D12 manual fix plus Retry reruns conversion; invalid files discovered on later Reload stay untouched", async (t) => {
  const f = fixture(t);
  f.put(f.source, '{"schemaVersion":3}');
  assert.equal((await f.operations.get(project)).status, "unavailable");
  f.put(f.source, '{"schemaVersion":2,"tools":{"jira":{"enabled":true}}}');
  await f.service.reload(project);
  assert.equal((await f.operations.get(project)).status, "available");
  assert.equal(existsSync(f.source), false);
  assert.match(readFileSync(f.service.paths.agent(project), "utf8"), /jira/);
  f.put(f.source, "{not JSON");
  await f.service.reload(project);
  assert.equal((await f.operations.get(project)).status, "unavailable");
  assert.equal(readFileSync(f.source, "utf8"), "{not JSON");
});
await test("D12 user invalid configuration does not abort initialization and survives failed CAS reset", async (t) => {
  const f = fixture(t),
    scope = { scope: "user" } as const,
    source = join(f.home, "config/harness.json");
  f.put(source, "invalid user bytes\n");
  const initialized = await f.service.initialize();
  assert.equal(
    (await f.service.getCreationPreferences()).status,
    "unavailable",
  );
  assert.equal(initialized.diagnostics[0].path, source);
  assert.equal((await f.operations.get(scope)).status, "unavailable");
  const preview = await f.repair.preview({
    target: { document: "agent", scope },
    replacement: defaults,
  });
  f.put(source, "new invalid user bytes\n");
  await assert.rejects(f.repair.apply(preview), /changed/);
  assert.equal(readFileSync(source, "utf8"), "new invalid user bytes\n");
  f.put(source, '{"version":3,"retry":{"enabled":false}}');
  await f.service.reload(scope);
  assert.equal((await f.operations.get(scope)).status, "available");
  assert.equal((await f.service.getCreationPreferences()).status, "available");
});

await test("D12 non-UTF8 scoped source is unavailable and protected reset preserves exact bytes", async (t) => {
  const f = fixture(t);
  f.put(f.source, "");
  const bytes = Buffer.from([0xff, 0x00, 0x7b, 0x7d]);
  writeFileSync(f.source, bytes);
  const state = await f.operations.get(project);
  assert.equal(state.status, "unavailable");
  assert.equal(state.diagnostics[0].path, f.source);
  assert.match(state.diagnostics[0].message!, /Non-UTF8/);
  const preview = await f.repair.preview({
    target: { document: "agent", scope: project },
    replacement: defaults,
  });
  assert.deepEqual(readFileSync(f.source), bytes);
  const applied = await f.repair.apply(preview);
  assert.deepEqual(readFileSync(applied.backupPath!), bytes);
});
