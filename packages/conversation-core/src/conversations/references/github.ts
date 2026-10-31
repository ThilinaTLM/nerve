import type { ConversationReference } from "@nervekit/contracts/core";

export interface GitHubRepository {
  host: string;
  owner: string;
  repo: string;
}
export function parseGitRemote(remote: string): GitHubRepository | null {
  const value = remote.trim();
  try {
    if (value.includes("://")) {
      const url = new URL(value);
      if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol))
        return null;
      const path = /^\/([^/]+)\/([^/]+?)\/?$/.exec(url.pathname);
      return path
        ? {
            host: url.hostname.toLowerCase(),
            owner: path[1],
            repo: path[2].replace(/\.git$/, ""),
          }
        : null;
    }
  } catch {
    return null;
  }
  const match = /^[^@/]+@([^/:]+):([^/]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
    value,
  );
  return match
    ? { host: match[1].toLowerCase(), owner: match[2], repo: match[3] }
    : null;
}
function reference(
  repo: GitHubRepository,
  number: string,
  kind: string,
  relationship: ConversationReference["relationship"] = "referenced",
  https = true,
): ConversationReference {
  return {
    provider: "github",
    resourceKey:
      `${repo.host}/${repo.owner}/${repo.repo}#${number}`.toLowerCase(),
    kind,
    relationship,
    url: https
      ? `https://${repo.host}/${repo.owner}/${repo.repo}/${kind === "pull_request" ? "pull" : "issues"}/${number}`
      : null,
    container: `${repo.owner}/${repo.repo}`,
    identifier: number,
  };
}
function withoutFences(text: string): string {
  let fence: { character: string; length: number } | undefined;
  return text
    .split("\n")
    .map((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker && !fence) {
        fence = { character: marker[0], length: marker.length };
        return "";
      }
      if (fence) {
        if (marker?.[0] === fence.character && marker.length >= fence.length)
          fence = undefined;
        return "";
      }
      return line;
    })
    .join("\n");
}
function cue(text: string): string {
  return /(?:\bPR|\bpull request)\s*$/i.test(text)
    ? "pull_request"
    : /\bissue\s*$/i.test(text)
      ? "issue"
      : "unknown";
}
function urls(
  text: string,
  remotes: GitHubRepository[],
  onReference?: (reference: ConversationReference, index: number) => void,
): ConversationReference[] {
  const hosts = new Set([
    "github.com",
    ...remotes.map((r) => r.host.toLowerCase()),
  ]);
  const result: ConversationReference[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    try {
      const url = new URL(match[0].replace(/[).,;!\]}]+$/, ""));
      const path =
        /^\/([^/]+)\/([^/]+)\/(pull|issues)\/([1-9]\d*)(?:\/|$)/.exec(
          url.pathname,
        );
      if (
        hosts.has(url.hostname.toLowerCase()) &&
        !url.username &&
        !url.password &&
        !url.port &&
        path
      ) {
        const value = reference(
          { host: url.hostname.toLowerCase(), owner: path[1], repo: path[2] },
          path[4],
          path[3] === "pull" ? "pull_request" : "issue",
          "referenced",
          url.protocol === "https:",
        );
        result.push(value);
        onReference?.(value, match.index);
      }
    } catch {
      /* Not a URL. */
    }
  }
  return result;
}
export function extractPromptReferences(
  text: string,
  remotes: GitHubRepository[] = [],
): ConversationReference[] {
  const clean = withoutFences(text);
  const result: { reference: ConversationReference; index: number }[] = [];
  urls(clean, remotes, (reference, index) => result.push({ reference, index }));
  // Remove URLs before shorthand matching so URL path segments cannot become shorthand.
  const shorthand = clean.replace(/https?:\/\/\S+/gi, (url) =>
    " ".repeat(url.length),
  );
  for (const match of shorthand.matchAll(
    /(?<![\w/])([\w.-]+)\/([\w.-]+)#([1-9]\d*)\b/g,
  )) {
    result.push({
      reference: reference(
        { host: "github.com", owner: match[1], repo: match[2] },
        match[3],
        cue(shorthand.slice(0, match.index)),
      ),
      index: match.index,
    });
  }
  const unique = [
    ...new Map(
      remotes.map((r) => [`${r.host}/${r.owner}/${r.repo}`.toLowerCase(), r]),
    ).values(),
  ];
  if (unique.length === 1)
    for (const match of shorthand.matchAll(/(?<![\w/])#([1-9]\d*)\b/g)) {
      const kind = cue(shorthand.slice(0, match.index));
      if (kind !== "unknown")
        result.push({
          reference: reference(unique[0], match[1], kind),
          index: match.index,
        });
    }
  return result
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.reference);
}
export function extractCreatedReference(
  command: string,
  exitCode: number | null,
  output: string,
  remotes: GitHubRepository[] = [],
): ConversationReference | null {
  if (exitCode !== 0) return null;
  // Accept an actual simple gh command, not quoted prose, echo, wrappers, or scripts.
  const unquoted = command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");
  const commands = [
    ...unquoted.matchAll(
      /(?:^|&&|\|\||;|\n)\s*gh\s+(pr|issue)\s+create(?=\s|$)/g,
    ),
  ];
  const kind = commands.at(-1)?.[1];
  if (!kind) return null;
  const found = urls(output, remotes)
    .filter((r) => r.kind === (kind === "pr" ? "pull_request" : "issue"))
    .at(-1);
  return found ? { ...found, relationship: "created" } : null;
}
