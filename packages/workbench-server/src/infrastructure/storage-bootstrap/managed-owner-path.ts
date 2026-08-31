import { resolve, sep } from "node:path";

export type ManagedOwnerPrefix = "conv_" | "tool_";

export function managedOwnerPathSegment(
  value: string,
  prefix: ManagedOwnerPrefix,
): string {
  if (
    !value.startsWith(prefix) ||
    value.length === prefix.length ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new Error(`Invalid managed owner id '${value}'.`);
  }
  return value.slice(prefix.length);
}

export function managedOwnerId(
  segment: string,
  prefix: ManagedOwnerPrefix,
): string {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new Error(`Invalid managed owner path segment '${segment}'.`);
  }
  return `${prefix}${segment}`;
}

export function assertManagedPath(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
  ) {
    throw new Error("Managed path escapes its storage root.");
  }
}
