import {
  relativePathForDisplay,
  resolveDisplayPath,
} from "@nervekit/ui-kit/display/path-links";

import type { CoreToolName } from "@nervekit/contracts/tools";
import type { MetaItem, PrimaryArg } from "../../cards/card-presentation";
import type { ToolArgumentSource } from "./argument-source";
import {
  COLLAPSED_LINES,
  SLIDE_OVERSCAN_LINES,
} from "../views/tool-view-helpers";
import { krokiConversion } from "../views/kroki-result-view";
import { askUserDraftQuestions } from "../tool-call/ask-user-state";
import {
  argumentPresentation,
  type ToolArgumentBody,
  type ToolLifecycleSpec,
  type ToolLifecycleStage,
} from "./tool-lifecycle-contracts";

const BODY_LINES = COLLAPSED_LINES;
const BODY_CHARS = 6_000;
const DRAFT_BODY_CHARS = 24_000;

function plural(count: number, noun: string, suffix = "s"): string {
  return `${count} ${noun}${count === 1 ? "" : suffix}`;
}

function boundedText(
  text: string | undefined,
  draft = false,
): string | undefined {
  if (!text) return undefined;
  const normalized = text.replace(/\r\n?/g, "\n");
  const suffix = normalized.slice(-(draft ? DRAFT_BODY_CHARS : BODY_CHARS));
  const lines = suffix.split("\n");
  const maxLines = BODY_LINES + (draft ? SLIDE_OVERSCAN_LINES : 0);
  const bounded = lines.slice(-maxLines).join("\n");
  return /^[\udc00-\udfff]/.test(bounded) ? bounded.slice(1) : bounded;
}

/** Leading lines: a diagram's first line names its type and direction. */
function boundedHead(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines.slice(0, BODY_LINES).join("\n").slice(0, BODY_CHARS);
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
  options: {
    force?: boolean;
    label?: string;
    head?: boolean;
    draft?: boolean;
  } = {},
): ToolArgumentBody {
  const bounded = options.head
    ? boundedHead(text)
    : boundedText(text, options.draft);
  if (!bounded || (!options.force && !bounded.includes("\n")))
    return { kind: "none" };
  return {
    kind: "code",
    text: bounded,
    language,
    label: options.label,
    tail: !options.head,
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

function editDiff(
  source: ToolArgumentSource,
  draft: boolean,
  single = false,
): string | undefined {
  let tail: string | undefined;
  const prefix = (value: string | undefined, marker: "+" | "-") => {
    if (!value) return;
    const lines = boundedText(value, draft)!.split("\n");
    const part = lines.map((line) => `${marker}${line}`).join("\n");
    tail = boundedText(tail ? `${tail}\n${part}` : part, draft);
  };
  for (const edit of single
    ? [source]
    : source.objectArraySources("edits", Infinity)) {
    prefix(edit.string("oldText"), "-");
    prefix(edit.string("newText"), "+");
  }
  return tail;
}

function editStats(source: ToolArgumentSource): {
  operations: number;
  additions: number;
  deletions: number;
} {
  const edits = source.objectArraySources("edits", Infinity);
  const operations = edits.length;
  let additions = 0;
  let deletions = 0;
  for (const edit of edits) {
    additions += edit.stringMetrics("newText")?.lines ?? 0;
    deletions += edit.stringMetrics("oldText")?.lines ?? 0;
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
      key: "read-range",
      text: `lines ${offset ?? 1}${limit !== undefined ? `–${(offset ?? 1) + limit - 1}` : ""}`,
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
  const commandLines = source.stringMetrics("command")?.lines ?? 0;
  const cwd = source.string("cwd");
  const timeout = source.number("timeout");
  return argumentPresentation({
    primaryArg: textArg(
      commandLines <= 1 ? command : undefined,
      command ? "inline command" : "Command",
    ),
    secondary: [
      ...(cwd
        ? [{ key: "cwd", text: `cwd ${cwd}`, mono: true } satisfies MetaItem]
        : []),
      ...(timeout !== undefined
        ? [{ key: "timeout", text: `timeout ${timeout}s` }]
        : []),
    ],
    // Stage-independent so the block never appears/disappears mid-lifecycle.
    body: codeBody(command, "bash", {
      force: (command?.length ?? 0) > 500 || commandLines > 1,
      draft: stage === "drafting",
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
  const codeLines = source.stringMetrics("code")?.lines ?? 0;
  const envKeys = source.objectKeys("env");
  const secondary: MetaItem[] = [];
  const runCwd = source.string("cwd");
  if (runCwd) secondary.push({ key: "cwd", text: `cwd ${runCwd}`, mono: true });
  const timeout = source.number("timeout");
  if (timeout !== undefined)
    secondary.push({ key: "timeout", text: `timeout ${timeout}s` });
  if (envKeys.length > 0)
    secondary.push({ text: plural(envKeys.length, "env key") });
  const allowFileWrite =
    source.boolean("allowFileWrite") ?? source.boolean("allow_file_write");
  if (allowFileWrite === false)
    secondary.push({ text: "writes off", tone: "warning" });
  // Stage-independent so the block never appears/disappears mid-lifecycle.
  // Env-key details surface via safety notes on the approval prompt instead.
  const body = codeBody(code, "python", {
    force: (code?.length ?? 0) > 500 || codeLines > 1,
    draft: stage === "drafting",
    label: "Script",
  });
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
  stage: ToolLifecycleStage,
  cwd?: string,
) {
  const content = source.string("content");
  const lines = source.stringMetrics("content")?.lines;
  return argumentPresentation({
    primaryArg: pathArg(source, cwd),
    secondary: [
      ...(lines !== undefined
        ? [{ key: "write-lines", text: plural(lines, "line") }]
        : []),
    ],
    body: content
      ? {
          kind: "code",
          text: boundedText(content, stage === "drafting")!,
          language: "text",
          tail: true,
        }
      : undefined,
    safetyNotes: ["Creates the file or overwrites it if it already exists."],
  });
}

function editPresentation(
  source: ToolArgumentSource,
  stage: ToolLifecycleStage,
  cwd?: string,
) {
  const stats = editStats(source);
  const edits = source.objectArraySources("edits", Infinity);
  const secondary: MetaItem[] = [];
  if (stats.operations > 0) {
    secondary.push({
      key: "add",
      text: `+${stats.additions}`,
      tone: "success",
    });
    secondary.push({
      key: "del",
      text: `−${stats.deletions}`,
      tone: "destructive",
    });
  }
  if (source.boolean("dryRun") === true)
    secondary.push({ text: "dry run", tone: "info" });
  return argumentPresentation({
    primaryArg: pathArg(source, cwd),
    secondary,
    body: edits.length
      ? {
          kind: "diff-sections",
          tail: true,
          sections: edits.map((edit, index) => ({
            key: String(index),
            caption: edits.length > 1 ? `Edit ${index + 1}` : undefined,
            text: editDiff(edit, stage === "drafting", true),
          })),
        }
      : undefined,
    safetyNotes: [
      source.boolean("dryRun") === true
        ? "Previews the edit without changing the file."
        : "Applies the proposed changes to the existing file.",
    ],
  });
}

function krokiPresentation(
  source: ToolArgumentSource,
  _stage: ToolLifecycleStage,
  cwd?: string,
) {
  const inline = source.string("source");
  const outputPath = source.string("output_path");
  const secondary: MetaItem[] = [
    {
      text: krokiConversion({
        diagram_type: source.string("diagram_type"),
        output_format: source.string("output_format"),
        output_path: outputPath,
      }),
    },
  ];
  if (outputPath) {
    secondary.push({
      text: `→ ${(cwd && relativePathForDisplay(outputPath, cwd)) || outputPath}`,
      mono: true,
    });
  }
  return argumentPresentation({
    // A source file is the preferred input; inline source is the fallback.
    primaryArg: source.string("source_path")
      ? pathArg(source, cwd, "source_path")
      : textArg(inline ? "inline" : undefined, "Diagram"),
    secondary,
    // Stage-independent so the block never appears/disappears mid-lifecycle.
    body: codeBody(inline, "text", {
      force: true,
      head: true,
      label: "Source",
    }),
    safetyNotes: [
      "Sends diagram source to the Kroki server configured in Settings.",
      ...(outputPath
        ? ["Creates the output file or overwrites it if it already exists."]
        : []),
    ],
  });
}

export const coreToolLifecycleSpecs = {
  read: defineToolLifecycleSpec({
    name: "read",
    argumentRegion: "none",
    completedView: "read",
    present: readPresentation,
  }),
  bash: defineToolLifecycleSpec({
    name: "bash",
    argumentRegion: "persistent",
    completedView: "bash",
    resultPlaceholder: { variant: "text", rows: 2 },
    emptyResult: "No output",
    present: bashPresentation,
  }),
  python_exec: defineToolLifecycleSpec({
    name: "python_exec",
    argumentRegion: "persistent",
    completedView: "python",
    resultPlaceholder: { variant: "text", rows: 2 },
    emptyResult: "No output",
    present: pythonPresentation,
  }),
  edit: defineToolLifecycleSpec({
    name: "edit",
    argumentRegion: "persistent",
    completedView: "edit",
    present: editPresentation,
  }),
  write: defineToolLifecycleSpec({
    name: "write",
    argumentRegion: "persistent",
    completedView: "write",
    present: writePresentation,
  }),
  grep: defineToolLifecycleSpec({
    name: "grep",
    argumentRegion: "none",
    completedView: "grep",
    emptyResult: "No matches",
    present: (source, stage) => {
      const paths = source.strings("paths");
      const scope = paths?.length ? paths.join(", ") : source.string("path");
      const secondary: MetaItem[] = [];
      if (scope) secondary.push({ key: "scope", text: scope, mono: true });
      if (source.string("glob"))
        secondary.push({ key: "glob", text: `glob ${source.string("glob")}` });
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
    argumentRegion: "none",
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
    argumentRegion: "none",
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
    // The question sections are the card's sheet in every state; the ask_user
    // view renders them (skeletons while streaming, see askUserDraftQuestions),
    // so there is no separate argument body.
    argumentRegion: "none",
    completedView: "ask_user",
    present: (source) => {
      const count = askUserDraftQuestions(source).length;
      return argumentPresentation({
        primaryArg: count > 0 ? textArg(plural(count, "question")) : undefined,
      });
    },
  }),
  todos_set: defineToolLifecycleSpec({
    name: "todos_set",
    argumentRegion: "persistent",
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
        primaryArg: textArg(
          items.length
            ? `${items.filter((item) => item.done).length}/${items.length} done`
            : "todos",
        ),
        body: items.length > 0 ? { kind: "checklist", items } : undefined,
      });
    },
  }),
  todos_get: defineToolLifecycleSpec({
    name: "todos_get",
    argumentRegion: "none",
    completedView: "todos",
    emptyResult: "No todos",
    present: () => argumentPresentation({ primaryArg: textArg("Get todos") }),
  }),
  web_search: defineToolLifecycleSpec({
    name: "web_search",
    argumentRegion: "none",
    completedView: "web_search",
    resultPlaceholder: { variant: "links", rows: 3 },
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
  kroki_export: defineToolLifecycleSpec({
    name: "kroki_export",
    argumentRegion: "persistent",
    completedView: "kroki_export",
    resultPlaceholder: { variant: "text", rows: 1 },
    emptyResult: "No diagram returned",
    present: krokiPresentation,
  }),
  generate_image: defineToolLifecycleSpec({
    name: "generate_image",
    argumentRegion: "none",
    completedView: "generate_image",
    resultPlaceholder: { variant: "image", rows: 6 },
    emptyResult: "No image returned",
    present: (source, stage) =>
      argumentPresentation({
        primaryArg: textArg(source.string("prompt"), "Image prompt"),
        secondary: source.string("size")
          ? [{ key: "size", text: source.string("size")!.replace("x", "×") }]
          : [],
        body:
          stage === "approval"
            ? keyValues([["Prompt", source.string("prompt")]])
            : undefined,
        safetyNotes: [
          "Sends the prompt to the image provider configured in Settings and may consume provider usage.",
        ],
      }),
  }),
  explain_image: defineToolLifecycleSpec({
    name: "explain_image",
    argumentRegion: "none",
    completedView: "explain_image",
    resultPlaceholder: { variant: "text", rows: 6 },
    present: (source, stage, cwd) =>
      argumentPresentation({
        primaryArg: pathArg(source, cwd),
        body:
          stage === "approval"
            ? keyValues([
                ["Image", source.string("path"), true],
                ["Focus", source.string("prompt")],
              ])
            : undefined,
        safetyNotes: [
          "Sends the image to the vision model configured in Nerve Settings.",
        ],
      }),
  }),
  web_fetch: defineToolLifecycleSpec({
    name: "web_fetch",
    argumentRegion: "none",
    completedView: "web_fetch",
    resultPlaceholder: { variant: "text", rows: 3 },
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
    | "python_exec"
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
    | "explain_image"
    | "generate_image"
    | "kroki_export"
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
