// Compiled as a normal sibling module in dist; no additional native artifact.
import { realpath } from "node:fs/promises";
import { discoverGitRepositories, readGitSnapshot } from "@nervekit/native";
import {
  categoryOf,
  isolatedError,
  parseGitIsolatedInput,
  serializeGitIsolatedFrame,
  type GitIsolatedFrame,
} from "./git-isolated-reader-protocol.js";
import { readGitIsolatedFrame } from "./git-isolated-reader-work.js";

// Keep the group leader alive until the parent has the complete frame and
// terminates the contained tree. In particular TERM must not strand a filter
// that ignores TERM after the leader exits. Parent escalates and awaits closed.
setInterval(() => {}, 60_000);
process.on("SIGTERM", () => {});

let frame: GitIsolatedFrame;
try {
  const input = parseGitIsolatedInput(process.argv[2] ?? "");
  frame = await readGitIsolatedFrame(input, {
    discover: discoverGitRepositories,
    snapshot: readGitSnapshot,
    canonicalPath: realpath,
  });
} catch (error) {
  // Native errors may contain filter commands, remote URLs or raw stderr.
  // Only a known category crosses IPC; messages are always fixed strings.
  frame = { version: 1, ok: false, error: isolatedError(categoryOf(error)) };
}
process.stdout.write(serializeGitIsolatedFrame(frame));
