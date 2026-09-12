import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalTimelineIdentityService } from "../../../src/domains/conversations/timeline/canonical-timeline-identity.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

test("INV-RESTORE-01 establishes one stable namespace and incarnation", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-timeline-identity-"));
  const databasePath = join(home, "nerve.sqlite");
  const firstStore = new CanonicalStore(databasePath);
  await firstStore.initialize();
  const service = new CanonicalTimelineIdentityService(firstStore);
  const [first, concurrent] = await Promise.all([
    service.resolve(),
    service.resolve(),
  ]);
  assert.deepEqual(concurrent, first);
  await firstStore.close();

  const reopenedStore = new CanonicalStore(databasePath);
  await reopenedStore.initialize();
  t.after(async () => {
    await reopenedStore.close();
    await rm(home, { recursive: true, force: true });
  });
  const reopened = await new CanonicalTimelineIdentityService(
    reopenedStore,
  ).resolve();
  assert.deepEqual(reopened, first);
  assert.match(first.namespaceId, /^namespace_/);
  assert.match(first.executionIncarnationId, /^incarnation_/);
});
