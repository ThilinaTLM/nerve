import { posix } from "node:path";

export function validatePattern(pattern: string): string | undefined {
  const value = pattern.trim();
  if (!value) return "Enter a glob pattern.";
  if (/\r|\n|\0/.test(value)) return "Glob patterns must be a single line.";
  try {
    posix.matchesGlob("example", value);
    return undefined;
  } catch {
    return "Enter a valid glob pattern.";
  }
}

export function patternMatches(value: string, pattern: string): boolean {
  if (validatePattern(pattern)) return false;
  return posix.matchesGlob(value, pattern.trim());
}

export function validatePathGlob(pattern: string): string | undefined {
  const value = pattern.trim();
  if (!value) return "Enter a path pattern.";
  if (value.includes("\\")) return "Use forward slashes in path patterns.";
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    return "Path patterns must be relative to the project.";
  }
  if (value.split("/").includes("..")) {
    return "Path patterns cannot traverse outside the project.";
  }
  return validatePattern(value);
}

export function pathGlobMatches(path: string, pattern: string): boolean {
  if (validatePathGlob(pattern)) return false;
  return posix.matchesGlob(path, pattern.trim());
}

export function validateCommandGlob(pattern: string): string | undefined {
  const error = validatePattern(pattern);
  if (error) return error;
  return pattern.trim() === "*"
    ? "Use a focused command pattern instead of matching every command."
    : undefined;
}

export function validateUrlGlob(pattern: string): string | undefined {
  const value = pattern.trim();
  const error = validatePattern(value);
  if (error) return error;
  if (!value.includes("://")) {
    return "URL patterns must include a scheme, such as https:// or *://.";
  }
  return undefined;
}

export function escapeGlobLiteral(value: string): string {
  return value.replace(/[?*[{]/g, (character) => `[${character}]`);
}
