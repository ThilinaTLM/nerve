import type { PermissionException } from "$lib/api";

export function exceptionTitle(exception: PermissionException): string {
  const selector = exception.selector;
  if (selector.kind === "tool") return selector.toolName;
  if (selector.kind === "command_prefix") return selector.tokens.join(" ");
  return selector.pattern;
}

export function exceptionDetail(exception: PermissionException): string {
  const selector = exception.selector;
  if (exception.effect === "allow") {
    if (selector.kind === "path_glob")
      return "File writes can run without asking";
    if (selector.kind === "web_host")
      return "Website fetches can run without asking";
    if (selector.kind === "command_prefix")
      return "Matching commands can run without asking";
    return "Tool can run without asking at the saved risk";
  }
  if (selector.kind === "path_glob") {
    const access =
      selector.access === "read_write"
        ? "Read and write"
        : selector.access === "read"
          ? "Read"
          : "Write";
    return `${access} access blocked for Nerve file tools`;
  }
  if (selector.kind === "web_host") return "Website fetches blocked";
  if (selector.kind === "command_prefix") return "Matching commands blocked";
  return "Tool blocked";
}

export function createExceptionId(): string {
  return `exception_${crypto.randomUUID().replaceAll("-", "")}`;
}
