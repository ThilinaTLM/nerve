import type { ToolDefinition } from "./contracts.js";

/*
 * Direct tools of installed extensions are per project: two projects may carry an extension
 * with the same id (and tool name) but different definitions. They live in scopes keyed by the
 * project directory ("" is no project), next to the global catalog of core and built-in tools.
 * A lookup with a scope sees that scope's tools first, then the global ones; without a scope it
 * sees only the global ones.
 */

const scopes = new Map<string, ReadonlyMap<string, ToolDefinition>>();

/** Project directories are keys: compare them by their normalized path. */
export function toolScopeKey(projectDir?: string): string {
  if (!projectDir) return "";
  let end = projectDir.length;
  while (end > 1 && projectDir[end - 1] === "/") end--;
  return projectDir.slice(0, end);
}

/** Replaces the tools of one scope (a project's installed extensions after a composition or reload). */
export function setScopedToolDefinitions(
  scope: string,
  definitions: readonly ToolDefinition[],
): void {
  const key = toolScopeKey(scope);
  if (definitions.length === 0) scopes.delete(key);
  else
    scopes.set(
      key,
      new Map(definitions.map((definition) => [definition.name, definition])),
    );
}

export function scopedToolDefinition(
  name: string,
  scope?: string,
): ToolDefinition | undefined {
  return scope === undefined
    ? undefined
    : scopes.get(toolScopeKey(scope))?.get(name);
}

/** The installed extensions' direct tools at a project. */
export function scopedToolDefinitions(
  scope?: string,
): readonly ToolDefinition[] {
  return scope === undefined
    ? []
    : [...(scopes.get(toolScopeKey(scope))?.values() ?? [])];
}

/** Names of the installed extensions' direct tools in every project scope. */
export function allScopedToolNames(): string[] {
  return [...scopes.values()].flatMap((scope) => [...scope.keys()]);
}
