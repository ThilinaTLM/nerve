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
function trimUrlPunctuation(value: string): string {
  let end = value.length;
  while (end > 0 && ").,;!]}".includes(value[end - 1])) end--;
  return value.slice(0, end);
}

/** Blank heredoc bodies: they are data, and stray apostrophes in them would break quote masking. */
function withoutHeredocBodies(command: string): string {
  const pending: { delimiter: string; tabs: boolean }[] = [];
  return command
    .split("\n")
    .map((line) => {
      const current = pending[0];
      if (current) {
        if (
          (current.tabs ? line.replace(/^\t+/, "") : line) === current.delimiter
        )
          pending.shift();
        return "";
      }
      for (const match of line.matchAll(
        /(?<!<)<<(-?)\s*(["']?)([A-Za-z_][\w.-]*)\2/g,
      ))
        pending.push({ delimiter: match[3], tabs: match[1] === "-" });
      return line;
    })
    .join("\n");
}

/** Mask shell quotes in one pass so quoted prose cannot look like a command. */
function maskShellQuotes(command: string): string {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < command.length; index++) {
    const quote = command[index];
    if (quote !== "'" && quote !== '"') continue;
    parts.push(command.slice(start, index), "''");
    index++;
    while (index < command.length && command[index] !== quote) {
      if (quote === '"' && command[index] === "\\") index++;
      index++;
    }
    start = index + 1;
  }
  parts.push(command.slice(start));
  return parts.join("");
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
      const url = new URL(trimUrlPunctuation(match[0]));
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
/** Source of a tool call that may run `gh pr create` / `gh issue create`. */
export interface CreatedReferenceSource {
  kind: "shell" | "python";
  text: string;
}

/** Reference kinds the source actually creates. */
function createdKinds(source: CreatedReferenceSource): Set<string> {
  const matches =
    source.kind === "shell"
      ? // A gh command at a command start, not quoted prose, echo, wrappers, or scripts.
        // Common wrappers and environment assignments may precede it.
        maskShellQuotes(withoutHeredocBodies(source.text)).matchAll(
          /(?:^|&&|[;|(\n{]|\$\(|\b(?:do|then|else)\b)\s*(?:(?:timeout(?:\s+-\S+)*\s+\S+|env(?:\s+-\S+)*|command|exec|time|nohup|[A-Za-z_]\w*=\S*)\s+)*gh\s+(pr|issue)\s+create(?=[\s;&|)}]|$)/g,
        )
      : // Heuristic, not a Python parser: a string starting with the command, or the argv list form.
        source.text.matchAll(
          /["']gh\s+(pr|issue)\s+create\b|["']gh["']\s*,\s*["'](pr|issue)["']\s*,\s*["']create["']/g,
        );
  return new Set(
    [...matches].map((match) =>
      (match[1] ?? match[2]) === "pr" ? "pull_request" : "issue",
    ),
  );
}

export function extractCreatedReferences(
  source: CreatedReferenceSource,
  exitCode: number | null,
  output: string,
  remotes: GitHubRepository[] = [],
): ConversationReference[] {
  if (exitCode !== 0) return [];
  const kinds = createdKinds(source);
  if (!kinds.size) return [];
  const result = new Map<string, ConversationReference>();
  urls(output, remotes, (found, index) => {
    // gh reports an existing PR as "... already exists:" followed by its URL.
    const before = output.slice(Math.max(0, index - 200), index);
    if (!kinds.has(found.kind) || /already exists:?\s*$/i.test(before)) return;
    if (!result.has(found.resourceKey))
      result.set(found.resourceKey, { ...found, relationship: "created" });
  });
  return [...result.values()];
}
