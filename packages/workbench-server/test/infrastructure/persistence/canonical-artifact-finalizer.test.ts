import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FilesystemCanonicalArtifactFinalizer } from "../../../src/infrastructure/persistence/canonical-artifact-finalizer.js";

test("canonical artifact finalizer publishes immutable evidence inside the home", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-artifact-finalizer-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const finalizer = new FilesystemCanonicalArtifactFinalizer(home);
  const artifact = await finalizer.finalize({
    artifactId: "artifact_context_test",
    ownerKind: "conversation",
    ownerId: "conv_context_test",
    relativeLocator: "context/artifact_context_test.json",
    bytes: Buffer.from("canonical"),
    mediaType: "application/json",
    semanticRole: "context_source_manifest",
  });
  assert.equal(artifact.availability, "available");
  assert.equal(artifact.byteLength, 9);
  assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    await readFile(join(home, artifact.relativeLocator), "utf8"),
    "canonical",
  );
  await assert.rejects(
    finalizer.finalize({
      artifactId: "artifact_escape_test",
      ownerKind: "conversation",
      ownerId: "conv_context_test",
      relativeLocator: "../escape.json",
      bytes: Buffer.from("escape"),
      mediaType: "application/json",
      semanticRole: "context_source_manifest",
    }),
    /escapes the storage home/,
  );
});
