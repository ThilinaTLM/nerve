import type { PermissionException, ToolDescriptor } from "$lib/api";

export function toolLabel(
  tool: PermissionException["tool"],
  tools: readonly ToolDescriptor[],
): string {
  return tools.find((descriptor) => descriptor.name === tool)?.name ?? tool;
}

export function exceptionEffectLabel(exception: PermissionException): string {
  return exception.effect === "allow" ? "Allow" : "Deny";
}

export function createExceptionId(): string {
  return `exception_${crypto.randomUUID().replaceAll("-", "")}`;
}
