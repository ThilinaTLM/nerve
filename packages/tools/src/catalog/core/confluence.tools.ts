import { Type } from "typebox";
import {
  executeConfluenceCreatePage,
  executeConfluenceDownloadPage,
  executeConfluenceGetPage,
  executeConfluenceManageAttachment,
  executeConfluenceManageComment,
  executeConfluenceManageLabel,
  executeConfluenceManagePage,
  executeConfluenceManageRestriction,
  executeConfluenceSearchPages,
  executeConfluenceSearchSpaces,
  executeConfluenceUpdatePage,
} from "../../execution/confluence/confluence.js";
import type { ToolDefinition } from "../types.js";

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
    include_footer_comments: Type.Optional(
      Type.Boolean({ description: "Fetch footer comments" }),
    ),
    include_inline_comments: Type.Optional(
      Type.Boolean({ description: "Fetch inline comments" }),
    ),
    include_restrictions: Type.Optional(
      Type.Boolean({ description: "Fetch page restrictions" }),
    ),
    comment_limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    comment_cursor: Type.Optional(Type.String()),
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

const downloadPageParameters = Type.Object(
  {
    page_id: Type.String({ description: "Page id" }),
    body_format: Type.Optional(bodyFormatRead),
    markdown: Type.Optional(
      Type.Boolean({
        description: "Write a best-effort read-only markdown sidecar",
      }),
    ),
    include_attachments: Type.Optional(
      Type.Boolean({ description: "Include attachment metadata" }),
    ),
    download_attachments: Type.Optional(
      Type.Boolean({ description: "Download attachment bytes for this page" }),
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

const dryRun = Type.Optional(
  Type.Boolean({ description: "Validate without mutating" }),
);
const commentKind = Type.Union([
  Type.Literal("footer"),
  Type.Literal("inline"),
]);
const commentRepresentation = Type.Union([
  Type.Literal("storage"),
  Type.Literal("atlas_doc_format"),
]);
const manageCommentParameters = Type.Union([
  Type.Object(
    {
      action: Type.Literal("create"),
      kind: commentKind,
      page_id: Type.String(),
      body: Type.String(),
      body_representation: Type.Optional(commentRepresentation),
      parent_comment_id: Type.Optional(Type.String()),
      inline_properties: Type.Optional(Type.Record(Type.String(), Type.Any())),
      dry_run: dryRun,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("update"),
      kind: commentKind,
      comment_id: Type.String(),
      body: Type.String(),
      body_representation: Type.Optional(commentRepresentation),
      version_message: Type.Optional(Type.String()),
      allow_stale: Type.Optional(Type.Boolean()),
      dry_run: dryRun,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("delete"),
      kind: commentKind,
      comment_id: Type.String(),
      dry_run: dryRun,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Union([Type.Literal("resolve"), Type.Literal("reopen")]),
      kind: Type.Literal("inline"),
      comment_id: Type.String(),
      dry_run: dryRun,
    },
    { additionalProperties: false },
  ),
]);
const managePageParameters = Type.Union([
  Type.Object(
    { action: Type.Literal("trash"), page_id: Type.String(), dry_run: dryRun },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("restore"),
      page_id: Type.String(),
      dry_run: dryRun,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("purge"), page_id: Type.String(), dry_run: dryRun },
    { additionalProperties: false },
  ),
]);
const manageLabelParameters = Type.Union([
  Type.Object(
    {
      action: Type.Literal("add"),
      page_id: Type.String(),
      label: Type.String(),
      prefix: Type.Optional(Type.String()),
      dry_run: dryRun,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("remove"),
      page_id: Type.String(),
      label: Type.String(),
      dry_run: dryRun,
    },
    { additionalProperties: false },
  ),
]);
const restrictionOperation = Type.Union([
  Type.Literal("read"),
  Type.Literal("update"),
]);
const restrictionSubject = Type.Union([
  Type.Literal("user"),
  Type.Literal("group"),
]);
const manageRestrictionParameters = Type.Union([
  Type.Object(
    {
      action: Type.Literal("add"),
      page_id: Type.String(),
      operation: restrictionOperation,
      subject_type: restrictionSubject,
      subject_id: Type.String(),
      dry_run: dryRun,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("remove"),
      page_id: Type.String(),
      operation: restrictionOperation,
      subject_type: restrictionSubject,
      subject_id: Type.String(),
      dry_run: dryRun,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("clear_operation"),
      page_id: Type.String(),
      operation: restrictionOperation,
      dry_run: dryRun,
    },
    { additionalProperties: false },
  ),
]);
const manageAttachmentParameters = Type.Union([
  Type.Object(
    {
      action: Type.Literal("upload"),
      page_id: Type.String(),
      file_path: Type.String(),
      filename: Type.Optional(Type.String()),
      comment: Type.Optional(Type.String()),
      minor_edit: Type.Optional(Type.Boolean()),
      update_existing: Type.Optional(Type.Boolean()),
      status: Type.Optional(pageStatus),
      dry_run: dryRun,
      save_to_file: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("rename"),
      page_id: Type.String(),
      attachment_id: Type.String(),
      new_filename: Type.String(),
      comment: Type.Optional(Type.String()),
      minor_edit: Type.Optional(Type.Boolean()),
      dry_run: dryRun,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("delete"),
      page_id: Type.String(),
      attachment_id: Type.String(),
      dry_run: dryRun,
    },
    { additionalProperties: false },
  ),
]);
export const confluenceToolDefinitions = [
  {
    name: "confluence_search_spaces",
    group: "confluence",
    baseRisk: "network",
    traits: ["read_only_network", "credentialed"],
    executionKind: "local",
    executor: executeConfluenceSearchSpaces,
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
    group: "confluence",
    baseRisk: "network",
    traits: ["read_only_network", "credentialed"],
    executionKind: "local",
    executor: executeConfluenceSearchPages,
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
    group: "confluence",
    baseRisk: "network",
    traits: ["read_only_network", "credentialed"],
    executionKind: "local",
    executor: executeConfluenceGetPage,
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
    name: "confluence_download_page",
    group: "confluence",
    baseRisk: "network",
    traits: ["read_only_network", "credentialed"],
    executionKind: "local",
    executor: executeConfluenceDownloadPage,
    label: "Confluence Download Page",
    description:
      "Download one page into editable JSON/storage XML artifacts with optional page attachments.",
    promptSnippet: "Download one Confluence page before file-backed editing",
    promptGuidelines: [confluenceGuideline],
    parameters: downloadPageParameters,
    executionMode: "parallel",
  },
  {
    name: "confluence_create_page",
    group: "confluence",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeConfluenceCreatePage,
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
    group: "confluence",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeConfluenceUpdatePage,
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
    name: "confluence_manage_comment",
    group: "confluence",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeConfluenceManageComment,
    label: "Confluence Manage Comment",
    description:
      "Create, update, delete, resolve, or reopen one Confluence comment.",
    promptSnippet:
      "Manage one Confluence comment only when explicitly requested",
    promptGuidelines: [confluenceGuideline],
    parameters: manageCommentParameters,
    executionMode: "sequential",
  },
  {
    name: "confluence_manage_page",
    group: "confluence",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeConfluenceManagePage,
    label: "Confluence Manage Page",
    description:
      "Trash, restore, or permanently purge one Confluence page; archive is not supported by the API.",
    promptSnippet:
      "Manage one Confluence page lifecycle only when explicitly requested",
    promptGuidelines: [confluenceGuideline],
    parameters: managePageParameters,
    executionMode: "sequential",
    classifyRisk: (args) =>
      args.action === "purge" ? "destructive" : "command",
  },
  {
    name: "confluence_manage_label",
    group: "confluence",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeConfluenceManageLabel,
    label: "Confluence Manage Label",
    description: "Add or remove one label on one Confluence page.",
    promptSnippet: "Manage one Confluence label only when explicitly requested",
    promptGuidelines: [confluenceGuideline],
    parameters: manageLabelParameters,
    executionMode: "sequential",
  },
  {
    name: "confluence_manage_restriction",
    group: "confluence",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeConfluenceManageRestriction,
    label: "Confluence Manage Restriction",
    description:
      "Add or remove one page restriction subject, or explicitly clear one operation.",
    promptSnippet:
      "Manage one Confluence restriction target only when explicitly requested",
    promptGuidelines: [confluenceGuideline],
    parameters: manageRestrictionParameters,
    executionMode: "sequential",
    classifyRisk: (args) =>
      args.action === "clear_operation" ? "destructive" : "command",
  },
  {
    name: "confluence_manage_attachment",
    group: "confluence",
    baseRisk: "command",
    traits: ["write_capable", "credentialed"],
    executionKind: "local",
    executor: executeConfluenceManageAttachment,
    label: "Confluence Manage Attachment",
    description: "Upload, rename, or delete one Confluence attachment.",
    promptSnippet:
      "Manage one Confluence attachment only when explicitly requested",
    promptGuidelines: [confluenceGuideline],
    parameters: manageAttachmentParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
