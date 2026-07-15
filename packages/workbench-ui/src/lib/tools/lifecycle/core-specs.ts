import {
  relativePathForDisplay,
  resolveDisplayPath,
} from "@nervekit/ui-kit/core/utils/path-links";
import type { CoreToolName } from "@nervekit/contracts";
import type { MetaItem, PrimaryArg } from "../views/tool-presentation-types";
import type { ToolArgumentSource } from "./argument-source";
import {
  argumentPresentation,
  type ToolArgumentBody,
  type ToolLifecycleSpec,
  type ToolLifecycleStage,
} from "./types";

const BODY_LINES = 10;
const BODY_CHARS = 6_000;

function plural(count: number, noun: string, suffix = "s"): string {
  return `${count} ${noun}${count === 1 ? "" : suffix}`;
}

function boundedText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const lineBounded =
    lines.length > BODY_LINES
      ? lines.slice(-BODY_LINES).join("\n")
      : normalized;
  return lineBounded.length > BODY_CHARS
    ? lineBounded.slice(-BODY_CHARS)
    : lineBounded;
}

function lineCount(text: string | undefined): number | undefined {
  return text === undefined
    ? undefined
    : text.length === 0
      ? 0
      : text.split(/\r?\n/).length;
}

function pathArg(
  source: ToolArgumentSource,
  cwd?: string,
  key = "path",
  fallback?: string,
): PrimaryArg | undefined {
  const path = source.string(key) ?? fallback;
  if (!path) return undefined;
  return {
    text: (cwd && relativePathForDisplay(path, cwd)) || path,
    openPath:
      path === "." ? undefined : cwd ? resolveDisplayPath(path, cwd) : path,
  };
}

function textArg(
  text: string | undefined,
  fallback?: string,
): PrimaryArg | undefined {
  const value = text || fallback;
  if (!value) return undefined;
  const bounded = value.length > 500 ? `${value.slice(0, 499)}…` : value;
  return { text: bounded };
}

function urlArg(url: string | undefined): PrimaryArg | undefined {
  if (!url) return undefined;
  return {
    text: url.length > 500 ? `${url.slice(0, 499)}…` : url,
    href: url,
  };
}

function codeBody(
  text: string | undefined,
  language: "bash" | "python" | "text",
  options: { force?: boolean; label?: string } = {},
): ToolArgumentBody {
  const bounded = boundedText(text);
  if (!bounded || (!options.force && !bounded.includes("\n")))
    return { kind: "none" };
  return {
    kind: "code",
    text: bounded,
    language,
    label: options.label,
    tail: true,
  };
}

function keyValues(
  items: Array<[string, string | number | boolean | undefined, boolean?]>,
): ToolArgumentBody {
  const visible = items.flatMap(([label, value, mono]) =>
    value === undefined || value === ""
      ? []
      : [{ label, value: String(value), mono }],
  );
  return visible.length > 0
    ? { kind: "key-values", items: visible }
    : { kind: "none" };
}

function editDiff(source: ToolArgumentSource): string | undefined {
  const lines: string[] = [];
  const prefix = (value: unknown, marker: "+" | "-") => {
    if (typeof value !== "string" || !value) return;
    for (const line of value.replace(/\r\n/g, "\n").split("\n"))
      lines.push(`${marker}${line}`);
  };
  for (const replacement of source.recordsArray("replacements") ?? []) {
    prefix(replacement.oldText, "-");
    prefix(replacement.newText, "+");
  }
  for (const insertion of source.recordsArray("insertions") ?? [])
    prefix(insertion.text, "+");
  for (const replacement of source.recordsArray("lineReplacements") ?? [])
    prefix(replacement.newText, "+");
  for (const insertion of source.recordsArray("lineInsertions") ?? [])
    prefix(insertion.text, "+");
  const patch = source.string("patch");
  if (patch) lines.push(...patch.replace(/\r\n/g, "\n").split("\n"));
  if (lines.length === 0) {
    const oldText = source.nestedStrings("oldText");
    const newText = source.nestedStrings("newText");
    oldText.forEach((value) => prefix(value, "-"));
    newText.forEach((value) => prefix(value, "+"));
  }
  return boundedText(lines.join("\n"));
}

function editStats(source: ToolArgumentSource): {
  operations: number;
  additions: number;
  deletions: number;
} {
  const operations =
    (source.count("replacements") ?? 0) +
    (source.count("insertions") ?? 0) +
    (source.count("lineReplacements") ?? 0) +
    (source.count("lineInsertions") ?? 0) +
    (source.string("patch") ? 1 : 0);
  const diff = editDiff(source) ?? "";
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { operations, additions, deletions };
}

export function defineToolLifecycleSpec<Name extends CoreToolName>(
  spec: ToolLifecycleSpec<Name>,
): ToolLifecycleSpec<Name> {
  return spec;
}

function readPresentation(
  source: ToolArgumentSource,
  stage: ToolLifecycleStage,
  cwd?: string,
) {
  const offset = source.number("offset");
  const limit = source.number("limit");
  const byteOffset = source.number("byteOffset");
  const byteLimit = source.number("byteLimit");
  const secondary: MetaItem[] = [];
  if (byteOffset !== undefined || byteLimit !== undefined) {
    secondary.push({
      text: `bytes ${byteOffset ?? 0}${byteLimit !== undefined ? ` +${byteLimit}` : ""}`,
    });
  } else if (offset !== undefined || limit !== undefined) {
    secondary.push({
      text: `lines ${offset ?? 1}${limit !== undefined ? ` +${limit}` : ""}`,
    });
  }
  return argumentPresentation({
    primaryArg: pathArg(source, cwd),
    secondary,
    body:
      stage === "approval"
        ? keyValues([
            ["Path", source.string("path"), true],
            ["Line start", offset],
            ["Line limit", limit],
            ["Byte offset", byteOffset],
            ["Byte limit", byteLimit],
          ])
        : undefined,
  });
}

function bashPresentation(
  source: ToolArgumentSource,
  stage: ToolLifecycleStage,
) {
  const command = source.string("command");
  const commandLines = lineCount(command) ?? 0;
  const cwd = source.string("cwd");
  const timeout = source.number("timeout");
  return argumentPresentation({
    primaryArg: textArg(
      commandLines <= 1 ? command : undefined,
      command ? "inline command" : "Command",
    ),
    secondary: [
      ...(cwd ? [{ text: `cwd ${cwd}`, mono: true } satisfies MetaItem] : []),
      ...(timeout !== undefined ? [{ text: `timeout ${timeout}s` }] : []),
    ],
    body: codeBody(command, "bash", {
      force:
        stage === "approval" &&
        (commandLines > 1 || (command?.length ?? 0) > 500),
      label: "Command",
    }),
    safetyNotes: [
      "Runs a Bash-compatible command in the selected working directory.",
    ],
  });
}

function pythonPresentation(
  source: ToolArgumentSource,
  stage: ToolLifecycleStage,
  cwd?: string,
) {
  const scriptPath = source.string("path");
  const code = source.string("code");
  const codeLines = lineCount(code) ?? 0;
  const envKeys = source.objectKeys("env");
  const secondary: MetaItem[] = [];
  const runCwd = source.string("cwd");
  if (runCwd) secondary.push({ text: `cwd ${runCwd}`, mono: true });
  const timeout = source.number("timeout");
  if (timeout !== undefined) secondary.push({ text: `timeout ${timeout}s` });
  if (envKeys.length > 0)
    secondary.push({ text: plural(envKeys.length, "env key") });
  const allowFileWrite =
    source.boolean("allowFileWrite") ?? source.boolean("allow_file_write");
  if (allowFileWrite === false)
    secondary.push({ text: "writes off", tone: "warning" });
  const envSummary =
    envKeys.length > 0 ? `Environment keys: ${envKeys.join(", ")}` : undefined;
  const bodyText = codeBody(code, "python", {
    force: stage === "approval" && (codeLines > 1 || (code?.length ?? 0) > 500),
    label: "Python",
  });
  const body =
    bodyText.kind !== "none"
      ? bodyText
      : stage === "approval" && envSummary
        ? ({ kind: "text-summary", text: envSummary } as const)
        : bodyText;
  return argumentPresentation({
    primaryArg: scriptPath
      ? pathArg(source, cwd)
      : textArg(
          codeLines <= 1 ? code : undefined,
          code ? "inline Python" : "Python",
        ),
    secondary,
    body,
    safetyNotes: [
      allowFileWrite === false
        ? "File writes are disabled."
        : "Python may write files unless the execution policy disables it.",
      ...(envKeys.length > 0
        ? [`Environment values are hidden; keys: ${envKeys.join(", ")}.`]
        : []),
    ],
  });
}

function writePresentation(
  source: ToolArgumentSource,
  _stage: ToolLifecycleStage,
  cwd?: string,
) {
  const content = source.string("content");
  const bytes =
    content === undefined
      ? undefined
      : new TextEncoder().encode(content).length;
  return argumentPresentation({
    primaryArg: pathArg(source, cwd),
    secondary: [
      ...(bytes !== undefined ? [{ text: plural(bytes, "byte") }] : []),
    ],
    body: content
      ? {
          kind: "code",
          text: boundedText(content)!,
          language: "text",
          tail: true,
        }
      : undefined,
    safetyNotes: ["Creates the file or overwrites it if it already exists."],
  });
}

function editPresentation(
  source: ToolArgumentSource,
  _stage: ToolLifecycleStage,
  cwd?: string,
) {
  const stats = editStats(source);
  const diff = editDiff(source);
  const secondary: MetaItem[] = [];
  if (stats.operations > 0)
    secondary.push({ text: plural(stats.operations, "operation") });
  if (stats.additions > 0)
    secondary.push({ text: `+${stats.additions}`, tone: "success" });
  if (stats.deletions > 0)
    secondary.push({ text: `-${stats.deletions}`, tone: "error" });
  if (source.boolean("dryRun") === true)
    secondary.push({ text: "dry run", tone: "info" });
  return argumentPresentation({
    primaryArg: pathArg(source, cwd),
    secondary,
    body: diff ? { kind: "diff", text: diff, tail: true } : undefined,
    safetyNotes: [
      source.boolean("dryRun") === true
        ? "Previews the edit without changing the file."
        : "Applies the proposed changes to the existing file.",
    ],
  });
}

export const coreToolLifecycleSpecs = {
  read: defineToolLifecycleSpec({
    name: "read",
    draftBody: "none",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "read",
    present: readPresentation,
  }),
  bash: defineToolLifecycleSpec({
    name: "bash",
    draftBody: "meaningful",
    approvalDetail: "full",
    executionHandoff: "retain-draft-until-output",
    completedView: "bash",
    emptyResult: "No output",
    present: bashPresentation,
  }),
  python: defineToolLifecycleSpec({
    name: "python",
    draftBody: "meaningful",
    approvalDetail: "full",
    executionHandoff: "retain-draft-until-output",
    completedView: "python",
    emptyResult: "No output",
    present: pythonPresentation,
  }),
  edit: defineToolLifecycleSpec({
    name: "edit",
    draftBody: "meaningful",
    approvalDetail: "full",
    executionHandoff: "retain-draft-until-output",
    completedView: "edit",
    present: editPresentation,
  }),
  write: defineToolLifecycleSpec({
    name: "write",
    draftBody: "meaningful",
    approvalDetail: "full",
    executionHandoff: "retain-draft-until-output",
    completedView: "write",
    present: writePresentation,
  }),
  grep: defineToolLifecycleSpec({
    name: "grep",
    draftBody: "none",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "grep",
    emptyResult: "No matches",
    present: (source, stage) => {
      const paths = source.strings("paths");
      const scope = paths?.length ? paths.join(", ") : source.string("path");
      const secondary: MetaItem[] = [];
      if (scope) secondary.push({ text: scope, mono: true });
      if (source.string("glob"))
        secondary.push({ text: `glob ${source.string("glob")}` });
      secondary.push({ text: source.boolean("literal") ? "literal" : "regex" });
      if (source.boolean("ignoreCase")) secondary.push({ text: "ignore case" });
      if ((source.number("context") ?? 0) > 0)
        secondary.push({ text: `context ${source.number("context")}` });
      if (
        source.number("limit") !== undefined &&
        source.number("limit") !== 100
      )
        secondary.push({ text: `max ${source.number("limit")}` });
      return argumentPresentation({
        primaryArg: textArg(source.string("pattern"), "Pattern"),
        secondary,
        body:
          stage === "approval"
            ? keyValues([
                ["Scope", scope ?? "project root", true],
                [
                  "Pattern mode",
                  source.boolean("literal") ? "literal" : "regular expression",
                ],
              ])
            : undefined,
      });
    },
  }),
  find: defineToolLifecycleSpec({
    name: "find",
    draftBody: "none",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "find",
    emptyResult: "No files found",
    present: (source, stage, cwd) =>
      argumentPresentation({
        primaryArg: textArg(source.string("pattern"), "Glob pattern"),
        secondary: [
          ...(source.string("path")
            ? [
                {
                  text:
                    (cwd &&
                      relativePathForDisplay(source.string("path")!, cwd)) ||
                    source.string("path")!,
                  mono: true,
                },
              ]
            : []),
          ...(source.number("limit") !== undefined &&
          source.number("limit") !== 1000
            ? [{ text: `max ${source.number("limit")}` }]
            : []),
        ],
        body:
          stage === "approval"
            ? keyValues([
                ["Search root", source.string("path") ?? "project root", true],
              ])
            : undefined,
      }),
  }),
  ls: defineToolLifecycleSpec({
    name: "ls",
    draftBody: "none",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "ls",
    emptyResult: "Empty directory",
    present: (source, stage, cwd) =>
      argumentPresentation({
        primaryArg: pathArg(source, cwd, "path", "."),
        secondary:
          source.number("limit") !== undefined && source.number("limit") !== 500
            ? [{ text: `max ${source.number("limit")}` }]
            : [],
        body:
          stage === "approval"
            ? keyValues([
                ["Directory", source.string("path") ?? "project root", true],
              ])
            : undefined,
      }),
  }),
  ask_user: defineToolLifecycleSpec({
    name: "ask_user",
    draftBody: "meaningful",
    approvalDetail: "summary",
    executionHandoff: "replace-with-interaction",
    completedView: "ask_user",
    present: (source) => {
      const lines = [
        source.string("context")
          ? `Context: ${source.string("context")}`
          : undefined,
        source.string("recommendation")
          ? `Recommendation: ${source.string("recommendation")}`
          : undefined,
      ].filter((line): line is string => Boolean(line));
      return argumentPresentation({
        primaryArg: textArg(source.string("question"), "Question"),
        body:
          lines.length > 0
            ? { kind: "text-summary", text: boundedText(lines.join("\n\n"))! }
            : undefined,
      });
    },
  }),
  todos_set: defineToolLifecycleSpec({
    name: "todos_set",
    draftBody: "meaningful",
    approvalDetail: "summary",
    executionHandoff: "retain-draft-until-output",
    completedView: "todos",
    present: (source) => {
      const exact = source.recordsArray("todos") ?? [];
      const partial = source.nestedStrings("todo");
      const items =
        exact.length > 0
          ? exact.flatMap((item) =>
              typeof item.todo === "string"
                ? [{ text: item.todo, done: item.done === true }]
                : [],
            )
          : partial.map((text) => ({ text, done: false }));
      return argumentPresentation({
        primaryArg: textArg("todos"),
        secondary:
          items.length > 0
            ? [
                {
                  text: plural(
                    items.filter((item) => item.done).length,
                    "done",
                  ),
                },
                { text: `${items.length} total` },
              ]
            : [],
        body: items.length > 0 ? { kind: "checklist", items } : undefined,
      });
    },
  }),
  todos_get: defineToolLifecycleSpec({
    name: "todos_get",
    draftBody: "none",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "todos",
    emptyResult: "No todos",
    present: () => argumentPresentation({ primaryArg: textArg("Get todos") }),
  }),
  web_search: defineToolLifecycleSpec({
    name: "web_search",
    draftBody: "none",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "web_search",
    emptyResult: "No results",
    present: (source, stage) =>
      argumentPresentation({
        primaryArg: textArg(source.string("query"), "Search query"),
        secondary:
          source.number("max_results") !== undefined &&
          source.number("max_results") !== 5
            ? [{ text: `max ${source.number("max_results")}` }]
            : [],
        body:
          stage === "approval"
            ? keyValues([["External search", source.string("query")]])
            : undefined,
        safetyNotes: [
          "Sends the query to the configured external search provider.",
        ],
      }),
  }),
  web_fetch: defineToolLifecycleSpec({
    name: "web_fetch",
    draftBody: "none",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "web_fetch",
    present: (source, stage) =>
      argumentPresentation({
        primaryArg: urlArg(source.string("url")) ?? textArg("URL"),
        secondary: [
          { text: source.boolean("raw") ? "raw download" : "converted" },
        ],
        body:
          stage === "approval"
            ? keyValues([
                ["Destination", source.string("url")],
                [
                  "Mode",
                  source.boolean("raw")
                    ? "save raw response"
                    : "convert to readable text",
                ],
              ])
            : undefined,
        safetyNotes: ["Fetches content from an external URL."],
      }),
  }),
} satisfies Record<
  Extract<
    CoreToolName,
    | "read"
    | "bash"
    | "python"
    | "edit"
    | "write"
    | "grep"
    | "find"
    | "ls"
    | "ask_user"
    | "todos_set"
    | "todos_get"
    | "web_search"
    | "web_fetch"
  >,
  ToolLifecycleSpec
>;

export {
  boundedText,
  codeBody,
  keyValues,
  lineCount,
  pathArg,
  plural,
  textArg,
};
