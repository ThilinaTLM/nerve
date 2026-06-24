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

  const scpLike = trimmed.match(/^(?:(?:[^@/\s]+)@)?([^:/\s]+):\S+$/);
  return scpLike ? isGithubHost(scpLike[1] ?? "") : false;
}

export function parseGitRemoteUrls(stdout: string): string[] {
  const urls = new Set<string>();
  for (const line of stdout.split("\n")) {
    const match = line.trim().match(/^\S+\s+(.+?)(?:\s+\((?:fetch|push)\))?$/);
    const url = match?.[1]?.trim();
    if (url) urls.add(url);
  }
  return [...urls];
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
