import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { ArtifactReference } from "@nervekit/contracts/conversations";
import type { CanonicalArtifactFinalizer } from "../../domains/conversations/timeline/canonical-auto-compaction.service.js";
import { atomicWriteFile } from "../storage-bootstrap/file-mutations.js";

/** Finalizes immutable canonical evidence before its SQLite reference commits. */
export class FilesystemCanonicalArtifactFinalizer implements CanonicalArtifactFinalizer {
  constructor(private readonly home: string) {}

  async finalize(input: {
    artifactId: string;
    ownerKind: "conversation";
    ownerId: string;
    relativeLocator: string;
    bytes: Uint8Array;
    mediaType: "application/json";
    semanticRole:
      | "context_source_manifest"
      | "context_transitive_boundary_manifest";
  }): Promise<ArtifactReference> {
    const root = resolve(this.home);
    const path = resolve(root, input.relativeLocator);
    if (path === root || !path.startsWith(`${root}${sep}`)) {
      throw new Error("Canonical artifact locator escapes the storage home.");
    }
    const bytes = Buffer.from(input.bytes);
    await atomicWriteFile(path, bytes, { mode: 0o600 });
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return {
      artifactId: input.artifactId,
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      relativeLocator: input.relativeLocator,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      byteLength: bytes.byteLength,
      mediaType: input.mediaType,
      semanticRole: input.semanticRole,
      availability: "available",
    };
  }
}
