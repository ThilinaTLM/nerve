import { Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

const confluenceGuideline =
  "Use Confluence tools only when the Confluence module is enabled; use storage XML/JSONL as the editable source of truth, treat markdown as read-only, keep limits narrow, and mutate pages/attachments only when explicitly requested.";

const stringArray = (description: string) =>
  Type.Array(Type.String(), { description });
const bodyFormatRead = Type.Union([
  Type.Literal("storage"),
  Type.Literal("atlas_doc_format"),
]);
const pageBodyFormat = Type.Union([
  Type.Literal("storage"),
  Type.Literal("atlas_doc_format"),
  Type.Literal("view"),
  Type.Literal("export_view"),
  Type.Literal("anonymous_export_view"),
  Type.Literal("styled_view"),
  Type.Literal("editor"),
]);
const writeBodyRepresentation = Type.Union([
  Type.Literal("storage"),
  Type.Literal("atlas_doc_format"),
  Type.Literal("wiki"),
]);
const pageStatus = Type.Union([Type.Literal("current"), Type.Literal("draft")]);

const searchSpacesParameters = Type.Object(
  {
    query: Type.Optional(Type.String({ description: "Space search query" })),
    keys: Type.Optional(stringArray("Space keys to resolve")),
    ids: Type.Optional(stringArray("Space ids to resolve")),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum spaces to return",
        minimum: 1,
        maximum: 100,
      }),
    ),
    cursor: Type.Optional(Type.String({ description: "Continuation cursor" })),
    save_to_file: Type.Optional(
      Type.Boolean({
        description: "Save the raw JSON response (default: true)",
      }),
    ),
  },
  { additionalProperties: false },
);

const searchPagesParameters = Type.Object(
  {
    cql: Type.Optional(Type.String({ description: "Confluence CQL query" })),
    query: Type.Optional(
      Type.String({ description: "Free-text search query" }),
    ),
    space_key: Type.Optional(Type.String({ description: "Space key filter" })),
    space_id: Type.Optional(Type.String({ description: "Space id filter" })),
    title: Type.Optional(Type.String({ description: "Exact title filter" })),
    status: Type.Optional(Type.String({ description: "Page status filter" })),
    body_format: Type.Optional(bodyFormatRead),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum pages to return",
        minimum: 1,
        maximum: 100,
      }),
    ),
    cursor: Type.Optional(Type.String({ description: "Continuation cursor" })),
    save_to_file: Type.Optional(
      Type.Boolean({
        description: "Save the raw JSON response (default: true)",
      }),
    ),
  },
  { additionalProperties: false },
);

const getPageParameters = Type.Object(
  {
    page_id: Type.String({ description: "Confluence page id" }),
    body_format: Type.Optional(pageBodyFormat),
    include_labels: Type.Optional(
      Type.Boolean({ description: "Fetch page labels" }),
    ),
    include_properties: Type.Optional(
      Type.Boolean({ description: "Fetch page properties" }),
    ),
    include_operations: Type.Optional(
      Type.Boolean({ description: "Fetch available operations" }),
    ),
    include_versions: Type.Optional(
      Type.Boolean({ description: "Fetch page versions" }),
    ),
    include_version: Type.Optional(
      Type.Boolean({ description: "Include version metadata" }),
    ),
    include_direct_children: Type.Optional(
      Type.Boolean({ description: "Fetch direct child pages" }),
    ),
    include_attachments: Type.Optional(
      Type.Boolean({ description: "Fetch attachment metadata" }),
    ),
    markdown: Type.Optional(
      Type.Boolean({
        description: "Write a best-effort read-only markdown sidecar",
      }),
    ),
    save_to_file: Type.Optional(
      Type.Boolean({
        description: "Save the raw JSON response (default: true)",
      }),
    ),
  },
  { additionalProperties: false },
);

const downloadPagesParameters = Type.Object(
  {
    page_id: Type.Optional(Type.String({ description: "Root page id" })),
    space_key: Type.Optional(Type.String({ description: "Space key" })),
    space_id: Type.Optional(Type.String({ description: "Space id" })),
    cql: Type.Optional(
      Type.String({ description: "CQL query to download results from" }),
    ),
    recurse: Type.Optional(
      Type.Boolean({
        description: "Include descendants when page_id is supplied",
      }),
    ),
    depth: Type.Optional(
      Type.Number({
        description: "Descendant depth (default: 1, max: 10)",
        minimum: 1,
        maximum: 10,
      }),
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum pages to download (default: 50, max: 250)",
        minimum: 1,
        maximum: 250,
      }),
    ),
    body_format: Type.Optional(bodyFormatRead),
    markdown: Type.Optional(
      Type.Boolean({
        description: "Write best-effort read-only markdown sidecars",
      }),
    ),
    include_attachments: Type.Optional(
      Type.Boolean({ description: "Include attachment metadata" }),
    ),
    download_attachments: Type.Optional(
      Type.Boolean({ description: "Download attachment bytes" }),
    ),
    save_to_file: Type.Optional(
      Type.Boolean({ description: "Save bundle artifacts (default: true)" }),
    ),
  },
  { additionalProperties: false },
);

const createPageParameters = Type.Object(
  {
    space_id: Type.Optional(Type.String({ description: "Space id" })),
    space_key: Type.Optional(
      Type.String({ description: "Space key; defaults from settings" }),
    ),
    title: Type.Optional(Type.String({ description: "Page title" })),
    parent_id: Type.Optional(Type.String({ description: "Parent page id" })),
    status: Type.Optional(pageStatus),
    body: Type.Optional(Type.String({ description: "Inline page body" })),
    body_file: Type.Optional(
      Type.String({
        description: "Path to a body file (storage XML/ADF/wiki)",
      }),
    ),
    page_file: Type.Optional(
      Type.String({ description: "Path to a page JSON or JSONL row" }),
    ),
    body_representation: Type.Optional(writeBodyRepresentation),
    dry_run: Type.Optional(
      Type.Boolean({
        description: "Return the create payload without mutating",
      }),
    ),
    return_page: Type.Optional(
      Type.Boolean({ description: "Fetch and summarize the created page" }),
    ),
    save_to_file: Type.Optional(
      Type.Boolean({
        description: "Save raw JSON/report artifacts (default: true)",
      }),
    ),
  },
  { additionalProperties: false },
);

const updatePageParameters = Type.Object(
  {
    page_id: Type.Optional(Type.String({ description: "Page id" })),
    page_file: Type.Optional(
      Type.String({ description: "Path to a page JSON or JSONL row" }),
    ),
    title: Type.Optional(Type.String({ description: "New title" })),
    parent_id: Type.Optional(Type.String({ description: "Parent page id" })),
    status: Type.Optional(pageStatus),
    body: Type.Optional(Type.String({ description: "Inline page body" })),
    body_file: Type.Optional(
      Type.String({
        description: "Path to a body file (storage XML/ADF/wiki)",
      }),
    ),
    body_representation: Type.Optional(writeBodyRepresentation),
    version_message: Type.Optional(
      Type.String({ description: "Version message" }),
    ),
    allow_stale: Type.Optional(
      Type.Boolean({
        description: "Allow publishing over a newer remote version",
      }),
    ),
    dry_run: Type.Optional(
      Type.Boolean({
        description: "Return the update payload without mutating",
      }),
    ),
    return_page: Type.Optional(
      Type.Boolean({
        description: "Fetch and summarize the page after updating",
      }),
    ),
    save_to_file: Type.Optional(
      Type.Boolean({
        description: "Save raw JSON/report artifacts (default: true)",
      }),
    ),
  },
  { additionalProperties: false },
);

const publishPagesParameters = Type.Object(
  {
    input_path: Type.String({
      description:
        "Bundle directory, manifest.json, pages.jsonl, or page JSON row",
    }),
    create_missing: Type.Optional(
      Type.Boolean({ description: "Create rows without ids" }),
    ),
    allow_stale: Type.Optional(
      Type.Boolean({
        description: "Allow publishing over newer remote versions",
      }),
    ),
    version_message: Type.Optional(
      Type.String({ description: "Version message for updated pages" }),
    ),
    dry_run: Type.Optional(
      Type.Boolean({ description: "Build a publish report without mutating" }),
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum rows to publish",
        minimum: 1,
        maximum: 250,
      }),
    ),
    save_to_file: Type.Optional(
      Type.Boolean({ description: "Save the publish report (default: true)" }),
    ),
  },
  { additionalProperties: false },
);

const uploadAttachmentParameters = Type.Object(
  {
    page_id: Type.String({ description: "Page id to attach the file to" }),
    file_path: Type.String({ description: "Local file path to upload" }),
    filename: Type.Optional(
      Type.String({ description: "Attachment filename override" }),
    ),
    comment: Type.Optional(
      Type.String({ description: "Attachment version comment" }),
    ),
    minor_edit: Type.Optional(
      Type.Boolean({ description: "Mark as a minor edit (default: true)" }),
    ),
    update_existing: Type.Optional(
      Type.Boolean({
        description: "Create/update idempotently with PUT (default: true)",
      }),
    ),
    status: Type.Optional(pageStatus),
    save_to_file: Type.Optional(
      Type.Boolean({
        description: "Save the raw JSON response (default: true)",
      }),
    ),
  },
  { additionalProperties: false },
);

export const confluenceToolDefinitions = [
  {
    name: "confluence_search_spaces",
    label: "Confluence Search Spaces",
    description: "List or resolve visible Confluence Cloud spaces.",
    promptSnippet:
      "Search Confluence spaces with narrow keys, ids, queries, and limits",
    promptGuidelines: [confluenceGuideline],
    parameters: searchSpacesParameters,
    executionMode: "parallel",
  },
  {
    name: "confluence_search_pages",
    label: "Confluence Search Pages",
    description:
      "Find Confluence pages by simple filters or CQL/free-text search.",
    promptSnippet: "Search Confluence pages with CQL or narrow filters",
    promptGuidelines: [confluenceGuideline],
    parameters: searchPagesParameters,
    executionMode: "parallel",
  },
  {
    name: "confluence_get_page",
    label: "Confluence Get Page",
    description:
      "Fetch one Confluence page with optional body, related metadata, attachments, and markdown sidecar.",
    promptSnippet:
      "Fetch a Confluence page by id; use storage XML as the source of truth",
    promptGuidelines: [confluenceGuideline],
    parameters: getPageParameters,
    executionMode: "parallel",
  },
  {
    name: "confluence_download_pages",
    label: "Confluence Download Pages",
    description:
      "Download a page, subtree, space, or CQL result set into editable JSONL/storage XML artifacts.",
    promptSnippet:
      "Download Confluence pages into JSONL and storage XML artifacts before editing",
    promptGuidelines: [confluenceGuideline],
    parameters: downloadPagesParameters,
    executionMode: "parallel",
  },
  {
    name: "confluence_create_page",
    label: "Confluence Create Page",
    description:
      "Create a Confluence page from inline storage XML, a body file, or a page JSON/JSONL row.",
    promptSnippet: "Create Confluence pages only when explicitly requested",
    promptGuidelines: [confluenceGuideline],
    parameters: createPageParameters,
    executionMode: "sequential",
  },
  {
    name: "confluence_update_page",
    label: "Confluence Update Page",
    description:
      "Update one Confluence page from inline body, body file, or a page JSON/JSONL row with stale-version protection.",
    promptSnippet:
      "Update Confluence pages only from storage XML/JSONL when explicitly requested",
    promptGuidelines: [confluenceGuideline],
    parameters: updatePageParameters,
    executionMode: "sequential",
  },
  {
    name: "confluence_publish_pages",
    label: "Confluence Publish Pages",
    description:
      "Publish one or more edited Confluence JSONL records directly to Confluence.",
    promptSnippet:
      "Publish edited Confluence JSONL records only when explicitly requested",
    promptGuidelines: [confluenceGuideline],
    parameters: publishPagesParameters,
    executionMode: "sequential",
  },
  {
    name: "confluence_upload_attachment",
    label: "Confluence Upload Attachment",
    description: "Upload or update a file attached to a Confluence page.",
    promptSnippet:
      "Upload Confluence attachments only when explicitly requested",
    promptGuidelines: [confluenceGuideline],
    parameters: uploadAttachmentParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];
