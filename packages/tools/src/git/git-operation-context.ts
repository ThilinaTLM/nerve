import { AsyncLocalStorage } from "node:async_hooks";
import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  canonicalGitDirectory,
  gitOperationLanes,
} from "./git-operation-lanes.js";
import { GitIdentityAdmission } from "./git-identity-admission.js";
import type { GitCommandOptions } from "./git-command.js";
import { gitPathKey } from "./git-path-key.js";

const context = new AsyncLocalStorage<{
  key: string;
  path: string;
  options: GitCommandOptions;
  active: boolean;
  network: boolean;
}>();
const networkContext = new AsyncLocalStorage<{ active: boolean }>();
let networkId = 0;
const admission = new GitIdentityAdmission();
// Unusual alias reentry may need I/O, but must not compete for outer request permits.
const nestedIdentities = new GitIdentityAdmission(16, 16);
export function hasGitRepositoryLane(): boolean {
  return Boolean(context.getStore()?.active);
}
export function currentGitCommandOptions(): GitCommandOptions {
  const scope = context.getStore();
  return scope?.active ? scope.options : {};
}
/** Shared gh credential acquisition is not owned by the first requesting operation. */
export function outsideGitOperation<T>(run: () => T): T {
  return context.exit(() => networkContext.exit(run));
}

function withIdentity<T>(
  path: string,
  identity: () => Promise<string>,
  network: boolean,
  run: () => Promise<T>,
  options: GitCommandOptions,
  identityKey = gitPathKey(path),
): Promise<T> {
  const pathKey = gitPathKey(path);
  const inherited = context.getStore();
  const parent = inherited?.active ? inherited : undefined;
  const reenter = () =>
    network ? withGitNetworkPermit(run, parent?.options.signal) : run();
  if (parent?.path === pathKey) return reenter();
  if (parent) {
    // A workflow already owns admission. Never recursively wait on its own permit.
    return nestedIdentities.run(
      identity,
      async (key) => {
        if (!parent.active)
          return withIdentity(
            path,
            async () => key,
            network,
            run,
            options,
            identityKey,
          );
        if (gitPathKey(key) !== parent.key)
          throw new Error("Nested Git workflows must use the same repository");
        return reenter();
      },
      parent.options.signal,
      identityKey,
    );
  }
  return admission.run(
    identity,
    (identity) => {
      const key = gitPathKey(identity);
      const reservedNetwork = network && !hasNetworkPermit();
      return gitOperationLanes.run(
        key,
        reservedNetwork,
        () => {
          const scope = {
            key,
            path: pathKey,
            options,
            active: true,
            network: reservedNetwork,
          };
          const invoke = () =>
            context.run(scope, async () => {
              try {
                return await run();
              } finally {
                scope.active = false;
              }
            });
          return network && !reservedNetwork
            ? withGitNetworkPermit(invoke, options.signal)
            : invoke();
        },
        options.signal,
      );
    },
    options.signal,
    identityKey,
  );
}

function hasNetworkPermit(): boolean {
  const repository = context.getStore();
  return !!(
    (repository?.active && repository.network) ||
    networkContext.getStore()?.active
  );
}

/** HTTP GitHub requests share the same cap as CLI network workflows, without
 * acquiring a second permit when called from an already admitted workflow. */
export function withGitNetworkPermit<T>(
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (hasNetworkPermit()) return run();
  const key = `git-network:${++networkId}`;
  return admission.run(
    async () => key,
    () =>
      gitOperationLanes.run(
        key,
        true,
        () => {
          const scope = { active: true };
          return networkContext.run(scope, async () => {
            try {
              return await run();
            } finally {
              scope.active = false;
            }
          });
        },
        signal,
      ),
    signal,
  );
}

export function inGitLane<T>(
  cwd: string,
  network: boolean,
  run: () => Promise<T>,
  options: GitCommandOptions = {},
): Promise<T> {
  const path = resolve(cwd);
  return withIdentity(
    path,
    () => canonicalGitDirectory(path),
    network,
    run,
    options,
  );
}

/** Validate a descriptor against the lane already held by a composed read. */
export function assertGitReadLane(commonDir: string): void {
  const parent = context.getStore();
  if (!parent?.active || parent.key !== gitPathKey(commonDir))
    throw new Error("Git repository identity changed during a composed read");
}

/** Independently admit a discovered repository head. Never acquire/hold another
 * repository's key while waiting: the backend batches only heads admitted here.
 */
export function inGitReadLane<T>(
  commonDir: string,
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const key = gitPathKey(commonDir);
  const parent = context.getStore();
  if (parent?.active) {
    if (parent.key !== key)
      return Promise.reject(
        new Error("Nested Git reads must use the same repository"),
      );
    return run();
  }
  return admission.run(
    async () => key,
    () => gitOperationLanes.run(key, false, run, signal),
    signal,
  );
}

/** Parent must exist. The reservation matches ordinary reads once clone creates .git. */
export function inGitCreationLane<T>(
  destination: string,
  network: boolean,
  run: () => Promise<T>,
  options: GitCommandOptions = {},
): Promise<T> {
  const target = resolve(destination);
  return withIdentity(
    target,
    async () => join(await realpath(dirname(target)), basename(target), ".git"),
    network,
    run,
    options,
    `create:${gitPathKey(target)}`,
  );
}
