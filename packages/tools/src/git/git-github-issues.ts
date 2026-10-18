import { runGitCommand } from "./git-command.js";

import type { GithubIssueSummary } from "@nervekit/contracts/git";
export type { GithubIssueSummary } from "@nervekit/contracts/git";

export async function listGithubIssues(
  cwd: string,
  signal: AbortSignal,
): Promise<GithubIssueSummary[]> {
  const result = await runGitCommand(
    "gh",
    cwd,
    [
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,url,state,updatedAt,author",
    ],
    { network: true, signal },
  );
  return parseGithubIssues(result.stdout);
}

export function parseGithubIssues(text: string): GithubIssueSummary[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error("Invalid issue list");
  return raw.slice(0, 100).map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Invalid issue");
    const row = value as Record<string, unknown>;
    if (
      !Number.isSafeInteger(row.number) ||
      Number(row.number) <= 0 ||
      typeof row.title !== "string" ||
      typeof row.url !== "string" ||
      !row.url.startsWith("https://") ||
      typeof row.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(row.updatedAt)) ||
      (row.state !== "OPEN" && row.state !== "CLOSED")
    )
      throw new Error("Invalid issue fields");
    const author = row.author as { login?: unknown } | null;
    return {
      number: Number(row.number),
      title: row.title.slice(0, 1000),
      url: row.url.slice(0, 2048),
      state: row.state,
      updatedAt: row.updatedAt,
      author:
        typeof author?.login === "string" ? author.login.slice(0, 100) : null,
    };
  });
}
