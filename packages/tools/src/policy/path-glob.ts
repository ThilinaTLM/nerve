import { posix } from "node:path";

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
  try {
    posix.matchesGlob("example/path.txt", value);
    return undefined;
  } catch {
    return "Enter a valid path glob.";
  }
}

export function pathGlobMatches(path: string, pattern: string): boolean {
  if (validatePathGlob(pattern)) return false;
  return posix.matchesGlob(path, pattern);
}

export function validateWebHostPattern(pattern: string): string | undefined {
  const value = pattern.trim().toLowerCase();
  const host = value.startsWith("*.") ? value.slice(2) : value;
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) {
    return "Enter a hostname such as example.com or *.example.com.";
  }
  if (host.startsWith(".") || host.endsWith(".") || host.includes("..")) {
    return "Enter a valid hostname.";
  }
  return undefined;
}

export function webHostMatches(host: string, pattern: string): boolean {
  if (validateWebHostPattern(pattern)) return false;
  const normalizedHost = host.toLowerCase();
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!normalizedPattern.startsWith("*.")) {
    return normalizedHost === normalizedPattern;
  }
  const suffix = normalizedPattern.slice(2);
  return normalizedHost.endsWith(`.${suffix}`) && normalizedHost !== suffix;
}
