import { lstat, mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export function resolveStorageSlot(args = [], repo = repositoryRoot) {
  const options = args.filter((arg) => arg !== "--");
  let slot = 1;
  if (options.length) {
    if (
      options.length !== 2 ||
      options[0] !== "--slot" ||
      !/^[1-9]\d*$/.test(options[1]) ||
      Number(options[1]) > 100
    ) {
      throw new Error(
        "Expected optional --slot N, where N is an integer from 1 to 100.",
      );
    }
    slot = Number(options[1]);
  }
  const root = resolve(repo);
  const httpPort = 43967 + 2 * (slot - 1);
  return {
    slot,
    repo: root,
    data: join(root, "data"),
    home: join(root, "data", `storage-${slot}`),
    profile: join(root, "data", `desktop-profile-${slot}`),
    httpPort,
    httpsPort: httpPort + 1,
    uiPort: 5173 + slot - 1,
  };
}

// Check existing paths before mkdir: redirected data directories must never
// cause us to create storage or profiles outside this checkout.
export async function assertSlotPaths(slot) {
  const repo = await realpath(slot.repo);
  for (const path of [slot.data, slot.home, slot.profile]) {
    try {
      const entry = await lstat(path);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(`Development path must be a real directory: ${path}`);
      }
      if (
        (await realpath(path)) !== join(repo, path.slice(slot.repo.length + 1))
      ) {
        throw new Error(
          `Development path must not redirect outside the checkout: ${path}`,
        );
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export async function createSlotParent(slot) {
  await assertSlotPaths(slot);
  await mkdir(slot.data, { recursive: true, mode: 0o700 });
  await assertSlotPaths(slot);
}

export function developmentEnvironment(
  slot,
  inherited = process.env,
  uiOnly = false,
) {
  const env = {
    ...inherited,
    NERVE_HOME: slot.home,
    NERVE_ELECTRON_USER_DATA: slot.profile,
    NERVE_HOST: "127.0.0.1",
    NERVE_PORT: String(slot.httpPort),
    NERVE_HTTPS_PORT: String(slot.httpsPort),
    NERVE_ALLOW_REMOTE: "0",
    NERVE_MOBILE_HTTPS: "1",
    NERVE_API_TARGET: `http://127.0.0.1:${slot.httpPort}`,
  };
  delete env.NERVE_DAEMON_TOKEN;
  delete env.NERVE_WEB_DIST;
  delete env.ELECTRON_RUN_AS_NODE;
  // A launcher started by Nerve must not adopt its parent's process-containment
  // scope. The new daemon/Electron host establishes its own ownership.
  delete env.NERVE_CGROUP_ROOT;
  delete env.NERVE_LINUX_DELEGATED_CGROUP;
  if (uiOnly) {
    if (inherited.NERVE_HOME?.trim())
      env.NERVE_HOME = resolve(inherited.NERVE_HOME);
    if (inherited.NERVE_API_TARGET?.trim()) {
      const target = new URL(inherited.NERVE_API_TARGET);
      if (!["http:", "https:"].includes(target.protocol)) {
        throw new Error("NERVE_API_TARGET must be an HTTP or HTTPS URL.");
      }
      const local =
        target.hostname === "localhost" ||
        target.hostname === "[::1]" ||
        target.hostname.startsWith("127.");
      if (
        local &&
        target.origin !== env.NERVE_API_TARGET &&
        !inherited.NERVE_HOME?.trim()
      ) {
        throw new Error(
          "Set both NERVE_HOME and NERVE_API_TARGET when targeting another local daemon, so Vite uses its token home.",
        );
      }
      env.NERVE_API_TARGET = inherited.NERVE_API_TARGET;
    } else if (inherited.NERVE_HOME?.trim()) delete env.NERVE_API_TARGET;
  }
  return env;
}
