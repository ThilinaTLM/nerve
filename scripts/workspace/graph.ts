import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./repo.ts";

export interface WorkspacePackage {
  /** Repository-relative POSIX directory, e.g. `packages/tools`. */
  directory: string;
  /** Direct `workspace:` dependencies of any kind. */
  dependencies: Set<string>;
  scripts: Record<string, string>;
}

/** Workspace packages keyed by package name, derived from `packages/*\/package.json`. */
export type Workspace = Map<string, WorkspacePackage>;

const DEPENDENCY_GROUPS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

interface Manifest {
  name?: unknown;
  scripts?: Record<string, string>;
  [group: string]: unknown;
}

function workspaceDependencyEntries(manifest: Manifest): [string, unknown][] {
  return DEPENDENCY_GROUPS.flatMap((group) =>
    Object.entries((manifest[group] as Record<string, unknown>) ?? {}),
  );
}

export function loadWorkspace(root: string = repoRoot): Workspace {
  const packagesRoot = join(root, "packages");
  const workspace: Workspace = new Map();
  const manifests = new Map<string, Manifest>();
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let manifest: Manifest;
    try {
      manifest = JSON.parse(
        readFileSync(join(packagesRoot, entry.name, "package.json"), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const name = manifest.name as string;
    manifests.set(name, manifest);
    workspace.set(name, {
      directory: `packages/${entry.name}`,
      dependencies: new Set(),
      scripts: manifest.scripts ?? {},
    });
  }
  for (const [name, pkg] of workspace) {
    for (const [dependency, version] of workspaceDependencyEntries(
      manifests.get(name)!,
    )) {
      if (
        workspace.has(dependency) &&
        typeof version === "string" &&
        version.startsWith("workspace:")
      )
        pkg.dependencies.add(dependency);
    }
  }
  return workspace;
}

/** Every package that (transitively) depends on one of `initial`, including `initial`. */
export function reverseDependencyClosure(
  initial: Iterable<string>,
  workspace: Workspace,
): Set<string> {
  const result = new Set(initial);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, pkg] of workspace) {
      if (result.has(name)) continue;
      if ([...pkg.dependencies].some((dependency) => result.has(dependency))) {
        result.add(name);
        changed = true;
      }
    }
  }
  return result;
}

/** Every package `initial` (transitively) depends on, including `initial`. */
export function dependencyClosure(
  initial: Iterable<string>,
  workspace: Workspace,
): Set<string> {
  const result = new Set(initial);
  const queue = [...result];
  while (queue.length > 0) {
    const name = queue.shift()!;
    for (const dependency of workspace.get(name)?.dependencies ?? []) {
      if (result.has(dependency)) continue;
      result.add(dependency);
      queue.push(dependency);
    }
  }
  return result;
}

export function packageForPath(
  path: string,
  workspace: Workspace,
): string | undefined {
  for (const [name, pkg] of workspace) {
    if (path === pkg.directory || path.startsWith(`${pkg.directory}/`))
      return name;
  }
  return undefined;
}

/**
 * Fail when the on-disk manifests (as listed by the Git file inventory)
 * disagree with the loaded workspace, so a broken graph never narrows a plan.
 */
export function validateWorkspace(
  root: string,
  files: readonly string[],
  workspace: Workspace,
): void {
  const names = new Set<string>();
  for (const file of files.filter((path) =>
    /^packages\/[^/]+\/package\.json$/.test(path),
  )) {
    const manifest = JSON.parse(
      readFileSync(join(root, file), "utf8"),
    ) as Manifest;
    if (
      typeof manifest.name !== "string" ||
      names.has(manifest.name) ||
      workspace.get(manifest.name)?.directory !==
        file.slice(0, -"/package.json".length)
    )
      throw new Error(`Invalid or duplicate workspace name in ${file}`);
    for (const [dependency, version] of workspaceDependencyEntries(manifest)) {
      if (
        typeof version === "string" &&
        version.startsWith("workspace:") &&
        !workspace.has(dependency)
      )
        throw new Error(
          `Unknown workspace dependency ${dependency} in ${file}`,
        );
    }
    names.add(manifest.name);
  }
  if (names.size !== workspace.size)
    throw new Error("Workspace metadata does not match the Git inventory");
}
