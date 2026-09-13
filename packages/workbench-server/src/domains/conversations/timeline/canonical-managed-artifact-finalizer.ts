import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { artifactReferenceSchema } from "@nervekit/contracts/conversations";
import type { StoragePaths } from "../../../infrastructure/storage-bootstrap/index.js";
import type { CanonicalArtifactFinalizer } from "./canonical-auto-compaction.service.js";

/** Finalizes immutable canonical artifacts before their SQLite reference commit. */
export class CanonicalManagedArtifactFinalizer implements CanonicalArtifactFinalizer {
  constructor(private readonly paths: StoragePaths) {}

  async finalize(input: Parameters<CanonicalArtifactFinalizer["finalize"]>[0]) {
    const ownerSegment = managedConversationSegment(input.ownerId);
    const root = join(
      this.paths.conversationsPath,
      ownerSegment,
      "canonical-artifacts",
    );
    const destination = resolve(root, input.relativeLocator);
    assertInside(root, destination);
    const temporary = join(
      this.paths.tmpPath,
      `canonical-artifact-${randomUUID()}.tmp`,
    );
    await Promise.all([
      mkdir(dirname(destination), { recursive: true, mode: 0o700 }),
      mkdir(this.paths.tmpPath, { recursive: true, mode: 0o700 }),
    ]);
    try {
      await writeFile(temporary, input.bytes, {
        mode: 0o600,
        flag: "wx",
      });
      await syncPath(temporary);
      await rename(temporary, destination);
      await syncPath(dirname(destination));
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    const digest = `sha256:${createHash("sha256")
      .update(input.bytes)
      .digest("hex")}`;
    return artifactReferenceSchema.parse({
      schemaVersion: 1,
      artifactId: input.artifactId,
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      relativeLocator: relative(this.paths.home, destination),
      digest,
      byteLength: input.bytes.byteLength,
      mediaType: input.mediaType,
      semanticRole: input.semanticRole,
      availability: "available",
    });
  }
}

function managedConversationSegment(ownerId: string): string {
  if (!/^conv_[A-Za-z0-9_-]+$/.test(ownerId)) {
    throw new Error("Canonical artifact conversation owner is invalid.");
  }
  return ownerId.slice("conv_".length);
}

function assertInside(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  if (
    candidate !== resolvedRoot &&
    !candidate.startsWith(`${resolvedRoot}${sep}`)
  ) {
    throw new Error("Canonical artifact locator escapes its owner root.");
  }
}

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP") throw error;
  } finally {
    await handle.close();
  }
}
