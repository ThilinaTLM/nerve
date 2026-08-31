import type { GithubChecksSummary } from "@nervekit/contracts/git";

function isGithubHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "github.com" || normalized === "ssh.github.com";
}

export type GithubRepositoryRef = {
  readonly hostname: "github.com";
  readonly owner: string;
  readonly repo: string;
  readonly remoteUrl: string;
};

export function parseGithubRepositoryUrl(
  remoteUrl: string,
): GithubRepositoryRef | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  let hostname: string | undefined;
  let pathname: string | undefined;
  try {
    const parsed = new URL(trimmed);
    hostname = parsed.hostname;
    pathname = parsed.pathname;
  } catch {
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1)
      return null;
    const authority = trimmed.slice(0, separatorIndex);
    pathname = trimmed.slice(separatorIndex + 1);
    if (authority.includes("/") || hasWhitespace(authority)) return null;
    const atIndex = authority.lastIndexOf("@");
    hostname = atIndex >= 0 ? authority.slice(atIndex + 1) : authority;
  }

  if (!hostname || !isGithubHost(hostname) || !pathname) return null;
  const parts = pathname
    .replace(/^\/+/, "")
    .replace(/\.git\/?$/, "")
    .split("/");
  if (parts.length !== 2 || parts.some((part) => !part || hasWhitespace(part)))
    return null;
  return {
    hostname: "github.com",
    owner: parts[0] as string,
    repo: parts[1] as string,
    remoteUrl: trimmed,
  };
}

export function parseGithubRepositoryRemote(
  stdout: string,
): GithubRepositoryRef | null {
  const entries = stdout.split("\n").flatMap((line) => {
    const parsed = parseGitRemoteEntry(line);
    if (!parsed) return [];
    const repository = parseGithubRepositoryUrl(parsed.url);
    return repository ? [{ ...parsed, repository }] : [];
  });
  const selected =
    entries.find(
      (entry) => entry.name === "origin" && entry.kind === "fetch",
    ) ??
    entries.find((entry) => entry.kind === "fetch") ??
    entries.find((entry) => entry.name === "origin") ??
    entries[0];
  return selected?.repository ?? null;
}

export function isGithubRemoteUrl(url: string): boolean {
  return parseGithubRepositoryUrl(url) !== null;
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

type GitRemoteEntry = {
  readonly name: string;
  readonly url: string;
  readonly kind: "fetch" | "push";
};

function parseGitRemoteEntry(line: string): GitRemoteEntry | null {
  const trimmed = line.trim();
  const firstWhitespaceIndex = findFirstWhitespace(trimmed);
  if (firstWhitespaceIndex <= 0) return null;
  const name = trimmed.slice(0, firstWhitespaceIndex);
  const value = trimmed.slice(firstWhitespaceIndex).trim();
  const match = /^(.*) \((fetch|push)\)$/.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return { name, url: match[1].trim(), kind: match[2] as "fetch" | "push" };
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

export function summarizeStatusCheckRollup(
  rollup: readonly unknown[] | null | undefined,
): GithubChecksSummary {
  if (!rollup) return noChecksSummary();
  const runs: GithubCheckRunRaw[] = [];
  for (const value of rollup) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const check = value as Record<string, unknown>;
    const name = stringValue(check.name) ?? stringValue(check.context);
    if (!name) continue;
    const status = stringValue(check.status)?.toUpperCase();
    const conclusion = stringValue(check.conclusion)?.toUpperCase();
    const state = stringValue(check.state)?.toUpperCase();
    runs.push({
      name,
      state:
        state ??
        (status && status !== "COMPLETED" ? status : conclusion) ??
        status ??
        "PENDING",
      link:
        stringValue(check.detailsUrl) ??
        stringValue(check.targetUrl) ??
        stringValue(check.link) ??
        undefined,
    });
  }
  return summarizeChecks(runs);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
