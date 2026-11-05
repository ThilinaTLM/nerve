import {} from "node:path";

export type ManagedOwnerPrefix = "conv_" | "tool_";

export function managedOwnerId(
  segment: string,
  prefix: ManagedOwnerPrefix,
): string {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new Error(`Invalid managed owner path segment '${segment}'.`);
  }
  return `${prefix}${segment}`;
}
