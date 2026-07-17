import type { CoreToolName } from "@nervekit/contracts";
import type { MetaItem } from "../views/tool-presentation-types";
import type { ToolArgumentSource } from "./argument-source";
import {
  atlassianDraftBody,
  draftField,
  dryRunField,
  optionalDraftField,
  streamedLineCount,
} from "./atlassian-draft";
import { boundedText, plural, textArg } from "./core-specs";
import {
  argumentPresentation,
  type ToolArgumentBody,
  type ToolLifecycleSpec,
  type ToolLifecycleStage,
} from "./types";

type ConfluenceToolName = Extract<CoreToolName, `confluence_${string}`>;

function spec<Name extends ConfluenceToolName>(
  value: ToolLifecycleSpec<Name>,
): ToolLifecycleSpec<Name> {
  return value;
}

function list(value: string[] | undefined): string | undefined {
  return value && value.length > 0 ? value.join(", ") : undefined;
}

function atlassianBody(lines: string[]): ToolArgumentBody {
  const text = boundedText(lines.join("\n"));
  return text ? { kind: "atlassian-summary", text } : { kind: "none" };
}

function dryRunMeta(source: ToolArgumentSource): MetaItem[] {
  return source.boolean("dry_run") === true
    ? [{ text: "dry run", tone: "info" }]
    : [];
}

function mutationSafety(source: ToolArgumentSource, effect: string): string[] {
  return [
    source.boolean("dry_run") === true
      ? `Dry run only; Confluence will not ${effect}.`
      : `This will ${effect} in Confluence.`,
  ];
}

function readOnlyBody(
  stage: ToolLifecycleStage,
  lines: string[],
): ToolArgumentBody | undefined {
  return stage === "approval" ? atlassianBody(lines) : undefined;
}

/**
 * Write-tool-style streaming body for page create/update: the page body
 * streams into an XML code block; file-sourced bodies have nothing to show.
 */
function pageBodyPresentation(source: ToolArgumentSource): {
  body: ToolArgumentBody;
  chips: MetaItem[];
} {
  const fileSourced = Boolean(
    source.string("page_file") ?? source.string("body_file"),
  );
  const representation = source.string("body_representation");
  const bodyText = source.string("body");
  const chips: MetaItem[] = [];
  const status = source.string("status");
  if (status) chips.push({ text: status });
  if (representation && representation !== "storage")
    chips.push({ text: representation });
  const lines = streamedLineCount(bodyText);
  if (lines !== undefined) chips.push({ text: `+${lines}`, tone: "success" });
  if (fileSourced) return { body: { kind: "none" }, chips };
  return {
    body: atlassianDraftBody({
      fields: [],
      text: {
        label: "Page body",
        text: bodyText,
        language:
          representation === undefined || representation === "storage"
            ? "xml"
            : undefined,
      },
    }),
    chips,
  };
}

export const confluenceToolLifecycleSpecs = {
  confluence_search_spaces: spec({
    name: "confluence_search_spaces",
    draftBody: "none",
    executingBody: "skeleton",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "confluence",
    emptyResult: "No spaces found",
    present: (source, stage) => {
      const keyOrId =
        list(source.strings("keys")) ?? list(source.strings("ids"));
      const secondary: MetaItem[] = [];
      if (source.string("type"))
        secondary.push({ text: source.string("type")! });
      if (source.string("status"))
        secondary.push({ text: source.string("status")! });
      if (source.number("limit") !== undefined)
        secondary.push({ text: `max ${source.number("limit")}` });
      return argumentPresentation({
        primaryArg: textArg(source.string("query") ?? keyOrId, "Spaces"),
        secondary,
        body: readOnlyBody(stage, [
          `Query: ${source.string("query") ?? keyOrId ?? "all spaces"}`,
        ]),
      });
    },
  }),
  confluence_search_pages: spec({
    name: "confluence_search_pages",
    draftBody: "none",
    executingBody: "skeleton",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "confluence",
    emptyResult: "No pages found",
    present: (source, stage) => {
      const query =
        source.string("cql") ??
        source.string("query") ??
        source.string("title");
      const secondary: MetaItem[] = [];
      if (source.string("space_key"))
        secondary.push({
          text: `space ${source.string("space_key")}`,
          mono: true,
        });
      if (source.string("status"))
        secondary.push({ text: source.string("status")! });
      if (source.number("limit") !== undefined)
        secondary.push({ text: `max ${source.number("limit")}` });
      if (source.string("cursor")) secondary.push({ text: "cursor" });
      return argumentPresentation({
        primaryArg: textArg(query, "Page query"),
        secondary,
        body: readOnlyBody(stage, [
          `${source.string("cql") ? "CQL" : "Query"}: ${query ?? ""}`,
          ...(source.string("space_key")
            ? [`Space: ${source.string("space_key")}`]
            : []),
        ]),
      });
    },
  }),
  confluence_get_page: spec({
    name: "confluence_get_page",
    draftBody: "none",
    executingBody: "skeleton",
    approvalDetail: "target",
    executionHandoff: "result-immediate",
    completedView: "confluence",
    present: (source, stage) => {
      const page = source.string("page_id") ?? source.string("page_file");
      const includes = [
        ["include_labels", "labels"],
        ["include_properties", "properties"],
        ["include_operations", "operations"],
        ["include_versions", "versions"],
        ["include_direct_children", "children"],
        ["include_attachments", "attachments"],
      ].flatMap(([key, label]) => (source.boolean(key) ? [label] : []));
      return argumentPresentation({
        primaryArg: textArg(page, "Page"),
        secondary: [
          ...(source.string("body_format")
            ? [{ text: source.string("body_format")! }]
            : []),
          ...includes.map((text) => ({ text })),
        ],
        body: readOnlyBody(stage, [
          `Page: ${page ?? ""}`,
          ...(includes.length ? [`Include: ${includes.join(", ")}`] : []),
        ]),
      });
    },
  }),
  confluence_download_pages: spec({
    name: "confluence_download_pages",
    draftBody: "none",
    executingBody: "skeleton",
    approvalDetail: "summary",
    executionHandoff: "result-immediate",
    completedView: "confluence",
    emptyResult: "No pages downloaded",
    present: (source, stage) => {
      const scope =
        source.string("page_id") ??
        source.string("space_key") ??
        source.string("space_id") ??
        source.string("cql");
      const output =
        source.string("output_dir") ?? source.string("download_dir");
      const secondary: MetaItem[] = [];
      if (source.boolean("recurse")) secondary.push({ text: "subtree" });
      if (source.number("depth") !== undefined)
        secondary.push({ text: `depth ${source.number("depth")}` });
      if (source.string("body_format"))
        secondary.push({ text: source.string("body_format")! });
      if (output)
        secondary.push({ text: output, mono: true, openPath: output });
      return argumentPresentation({
        primaryArg: textArg(scope, "Page download"),
        secondary,
        body: readOnlyBody(stage, [
          `Scope: ${scope ?? ""}`,
          ...(output ? [`Destination: ${output}`] : []),
          ...(source.boolean("download_attachments")
            ? ["Attachments: download"]
            : []),
        ]),
        safetyNotes: output ? [`Writes downloaded files under ${output}.`] : [],
      });
    },
  }),
  confluence_create_page: spec({
    name: "confluence_create_page",
    draftBody: "meaningful",
    approvalDetail: "full",
    executionHandoff: "retain-draft-until-output",
    completedView: "confluence",
    present: (source) => {
      const space = source.string("space_key") ?? source.string("space_id");
      const title = source.string("title") ?? source.string("page_file");
      const { body, chips } = pageBodyPresentation(source);
      return argumentPresentation({
        primaryArg: textArg(
          [space, title].filter(Boolean).join(" · "),
          "New Confluence page",
        ),
        secondary: [
          ...dryRunMeta(source),
          ...(source.string("parent_id")
            ? [{ text: `parent ${source.string("parent_id")}`, mono: true }]
            : []),
          ...chips,
        ],
        body,
        safetyNotes: mutationSafety(source, "create the page"),
      });
    },
  }),
  confluence_update_page: spec({
    name: "confluence_update_page",
    draftBody: "meaningful",
    approvalDetail: "full",
    executionHandoff: "retain-draft-until-output",
    completedView: "confluence",
    present: (source) => {
      const page = source.string("page_id") ?? source.string("page_file");
      const { body, chips } = pageBodyPresentation(source);
      return argumentPresentation({
        primaryArg: textArg(page, "Confluence page"),
        secondary: [
          ...dryRunMeta(source),
          ...(source.number("expected_version") !== undefined
            ? [{ text: `version ${source.number("expected_version")}` }]
            : []),
          ...(source.boolean("allow_stale")
            ? [{ text: "allow stale", tone: "warning" as const }]
            : []),
          ...chips,
        ],
        body,
        safetyNotes: mutationSafety(source, "update the page"),
      });
    },
  }),
  confluence_publish_pages: spec({
    name: "confluence_publish_pages",
    draftBody: "meaningful",
    approvalDetail: "full",
    executionHandoff: "retain-draft-until-output",
    completedView: "confluence",
    present: (source) => {
      const inputPath = source.string("input_path");
      const pageTitles = source.nestedStrings("title");
      const allowStale = source.boolean("allow_stale") === true;
      const body = atlassianDraftBody({
        fields: [
          draftField("Source", inputPath, { mono: true }),
          ...optionalDraftField(
            "Pages",
            pageTitles.length
              ? `${plural(pageTitles.length, "page")}: ${pageTitles
                  .slice(0, 5)
                  .join(", ")}${pageTitles.length > 5 ? ", …" : ""}`
              : undefined,
          ),
          ...optionalDraftField(
            "Version message",
            source.string("version_message"),
          ),
          draftField(
            "Conflict handling",
            allowStale ? "allow stale" : "enforce versions",
            allowStale ? { tone: "warning" } : {},
          ),
          ...(source.boolean("create_missing") === true
            ? [draftField("Create missing", "yes")]
            : []),
          ...dryRunField(source),
        ],
      });
      return argumentPresentation({
        primaryArg: inputPath
          ? {
              text: inputPath.split(/[\\/]/).pop() || inputPath,
              openPath: inputPath,
            }
          : textArg("Page bundle"),
        secondary: [
          ...dryRunMeta(source),
          ...(pageTitles.length
            ? [{ text: plural(pageTitles.length, "page") }]
            : []),
          ...(source.boolean("create_missing")
            ? [{ text: "create missing" }]
            : []),
          ...(source.boolean("allow_stale")
            ? [{ text: "allow stale", tone: "warning" as const }]
            : []),
        ],
        body,
        safetyNotes: mutationSafety(source, "publish the pages"),
      });
    },
  }),
  confluence_upload_attachment: spec({
    name: "confluence_upload_attachment",
    draftBody: "none",
    approvalDetail: "full",
    executionHandoff: "retain-draft-until-output",
    completedView: "confluence",
    present: (source, stage) => {
      const path = source.string("file_path");
      const filename = source.string("filename") ?? path?.split(/[\\/]/).pop();
      const page = source.string("page_id");
      const secondary: MetaItem[] = [];
      if (page) secondary.push({ text: `page ${page}`, mono: true });
      if (source.boolean("update_existing") === false)
        secondary.push({ text: "new only" });
      if (source.boolean("minor_edit")) secondary.push({ text: "minor edit" });
      return argumentPresentation({
        primaryArg: textArg(
          [filename, page].filter(Boolean).join(" · "),
          "Attachment",
        ),
        secondary,
        body:
          stage === "approval"
            ? atlassianDraftBody({
                fields: [
                  draftField("Target page", page, { mono: true }),
                  draftField("Source file", path, { mono: true }),
                  ...optionalDraftField("Filename", filename),
                  ...optionalDraftField("Comment", source.string("comment")),
                  draftField(
                    "Existing attachment",
                    source.boolean("update_existing") === false
                      ? "do not replace"
                      : "update if present",
                  ),
                ],
              })
            : undefined,
        safetyNotes: [
          "Uploads this local file to the selected Confluence page.",
        ],
      });
    },
  }),
} satisfies Record<ConfluenceToolName, ToolLifecycleSpec>;
