import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalManagedArtifactFinalizer } from "../../../src/domains/conversations/timeline/canonical-managed-artifact-finalizer.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/index.js";

test("INV-ARTIFACT-01 finalizes verified bytes inside the canonical owner root", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-artifact-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const finalizer = new CanonicalManagedArtifactFinalizer(storagePaths(home));
  const bytes = new TextEncoder().encode('{"source":"canonical"}');
  const artifact = await finalizer.finalize({
    artifactId: "artifact_context_source",
    ownerKind: "conversation",
    ownerId: "conv_artifact",
    relativeLocator: "context/source.json",
    bytes,
    mediaType: "application/json",
    semanticRole: "context_source_manifest",
  });
  assert.equal(artifact.availability, "available");
  assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    await readFile(join(home, artifact.relativeLocator)),
    Buffer.from(bytes),
  );
  await assert.rejects(
    finalizer.finalize({
      artifactId: "artifact_escape",
      ownerKind: "conversation",
      ownerId: "conv_artifact",
      relativeLocator: "../../../escape.json",
      bytes,
      mediaType: "application/json",
      semanticRole: "context_source_manifest",
    }),
    /escapes its owner root/,
  );
});
