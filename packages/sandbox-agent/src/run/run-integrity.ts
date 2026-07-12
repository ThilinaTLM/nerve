import type { RunIntegrityPort } from "@nervekit/host-runtime";
import { sandboxSha256Digest } from "../state/hash.js";

/**
 * Canonical integrity/checksum port for run transitions and checkpoints.
 * Uses the same canonical-JSON sha256 digest as the rest of the sandbox so
 * checksums are stable and comparable across restarts.
 */
export class SandboxRunIntegrity implements RunIntegrityPort {
  checksum(value: unknown): string {
    return sandboxSha256Digest(value);
  }
}
