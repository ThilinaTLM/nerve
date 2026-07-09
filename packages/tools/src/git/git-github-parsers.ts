import type { GithubChecksSummary } from "@nervekit/shared";

function isGithubHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "github.com" || normalized === "ssh.github.com";
}

export function isGithubRemoteUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname) return isGithubHost(parsed.hostname);
  } catch {
    // Fall through to SCP-like git remote syntax, e.g.
    // `git@github.com:owner/repo.git`.
  }

  const scpHost = parseScpLikeRemoteHost(trimmed);
  return scpHost ? isGithubHost(scpHost) : false;
}

function parseScpLikeRemoteHost(remoteUrl: string): string | null {
  const separatorIndex = remoteUrl.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === remoteUrl.length - 1)
    return null;

  const authority = remoteUrl.slice(0, separatorIndex);
  const path = remoteUrl.slice(separatorIndex + 1);
  if (
    authority.includes("/") ||
    hasWhitespace(authority) ||
    hasWhitespace(path)
  ) {
    return null;
  }

  const atIndex = authority.lastIndexOf("@");
  const host = atIndex >= 0 ? authority.slice(atIndex + 1) : authority;
  return host.length > 0 && !host.includes(":") ? host : null;
}

function hasWhitespace(value: string): boolean {
  for (const char of value) {
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      return true;
    }
  }
  return false;
}

export function parseGitRemoteUrls(stdout: string): string[] {
  const urls = new Set<string>();
  for (const line of stdout.split("\n")) {
    const url = parseGitRemoteUrlLine(line);
    if (url) urls.add(url);
  }
  return [...urls];
}

function parseGitRemoteUrlLine(line: string): string | null {
  const trimmed = line.trim();
  const firstWhitespaceIndex = findFirstWhitespace(trimmed);
  if (firstWhitespaceIndex <= 0) return null;

  const remoteUrl = trimmed.slice(firstWhitespaceIndex).trim();
  if (remoteUrl.endsWith(" (fetch)")) {
    return remoteUrl.slice(0, -" (fetch)".length).trim() || null;
  }
  if (remoteUrl.endsWith(" (push)")) {
    return remoteUrl.slice(0, -" (push)".length).trim() || null;
  }
  return remoteUrl || null;
}

function findFirstWhitespace(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      return index;
    }
  }
  return -1;
}

export type GithubCheckRunRaw = { name: string; state: string; link?: string };

export function noChecksSummary(): GithubChecksSummary {
  return {
    status: "none",
    total: 0,
    passed: 0,
    failed: 0,
    pending: 0,
    runs: [],
  };
}

export function parseGithubChecks(stdout: string): GithubChecksSummary {
  const raw = JSON.parse(stdout || "[]") as GithubCheckRunRaw[];
  return summarizeChecks(raw);
}

export function summarizeChecks(
  runs: GithubCheckRunRaw[],
): GithubChecksSummary {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  const normalized = runs.map((run) => {
    const state = run.state.toUpperCase();
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state)) passed += 1;
    else if (
      [
        "FAILURE",
        "ERROR",
        "CANCELLED",
        "TIMED_OUT",
        "ACTION_REQUIRED",
      ].includes(state)
    )
      failed += 1;
    else pending += 1;
    return {
      name: run.name,
      status: state.toLowerCase(),
      conclusion: state.toLowerCase(),
      url: run.link,
    };
  });
  const total = normalized.length;
  let status: GithubChecksSummary["status"] = "none";
  if (total > 0) {
    if (failed > 0) status = "failing";
    else if (pending > 0) status = "pending";
    else status = "passing";
  }
  return { status, total, passed, failed, pending, runs: normalized };
}
