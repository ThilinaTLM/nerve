import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ToolName } from "@nervekit/contracts";
import { requireToolDefinition } from "../catalog/manifest.js";
import type { ToolPermissionTargetDescriptor } from "../catalog/contracts.js";
import type { PermissionTarget, ShellCommandAssessment } from "./types.js";

export function permissionTargets(input: {
  toolName: ToolName;
  args: Record<string, unknown>;
  cwd?: string;
  projectDir?: string;
  command?: ShellCommandAssessment;
}): PermissionTarget[] {
  const descriptors =
    requireToolDefinition(input.toolName).permission?.targets ?? [];
  return descriptors.flatMap((descriptor) =>
    targetsForDescriptor(descriptor, input),
  );
}

function targetsForDescriptor(
  descriptor: ToolPermissionTargetDescriptor,
  input: {
    args: Record<string, unknown>;
    cwd?: string;
    projectDir?: string;
    command?: ShellCommandAssessment;
  },
): PermissionTarget[] {
  if (descriptor.kind === "command_segments") {
    return (
      input.command?.segments.map((segment) => ({
        kind: "command_segment" as const,
        normalizedTokens: segment.normalizedTokens,
        risk: segment.risk,
      })) ?? []
    );
  }
  if (descriptor.kind === "web_host") {
    const value = input.args[descriptor.argument];
    try {
      const url = new URL(typeof value === "string" ? value : "");
      url.hostname = url.hostname.toLowerCase();
      return [{ kind: "web_url", url: url.href }];
    } catch {
      return [];
    }
  }
  return pathInputs(descriptor, input.args).map((path) =>
    pathTarget(
      path,
      descriptor.access,
      descriptor.scope,
      input.cwd,
      input.projectDir,
    ),
  );
}

function pathInputs(
  descriptor: Extract<ToolPermissionTargetDescriptor, { kind: "path" }>,
  args: Record<string, unknown>,
): unknown[] {
  for (const argument of descriptor.arguments) {
    const value = args[argument];
    if (Array.isArray(value)) return value;
    if (value !== undefined) return [value];
  }
  return descriptor.defaultValue === undefined ? [] : [descriptor.defaultValue];
}

function pathTarget(
  input: unknown,
  access: "read" | "write",
  scope: "exact" | "tree",
  cwd = process.cwd(),
  projectDir?: string,
): PermissionTarget {
  const value = typeof input === "string" && input.trim() ? input : ".";
  const absolutePath = isAbsolute(value) ? resolve(value) : resolve(cwd, value);
  return {
    kind: "path",
    access,
    scope,
    absolutePath,
    ...(projectDir
      ? { projectRelativePath: relativeToProject(projectDir, absolutePath) }
      : {}),
  };
}

function relativeToProject(
  projectDir: string,
  absolutePath: string,
): string | undefined {
  const value = relative(resolve(projectDir), absolutePath);
  if (value === "") return ".";
  if (value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    return undefined;
  }
  return value.split(sep).join("/");
}
