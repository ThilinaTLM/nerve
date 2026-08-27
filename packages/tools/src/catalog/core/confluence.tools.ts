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
    keys: Type.Optional(stringArray("Exact space keys to resolve")),
    ids: Type.Optional(stringArray("Exact space ids to resolve")),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum spaces to return",
        minimum: 1,
        maximum: 100,
      }),
    ),
    cursor: Type.Optional(
      Type.String({
        description:
          "Opaque Confluence continuation cursor returned by the previous page",
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
    cursor: Type.Optional(
      Type.String({
        description:
          "Opaque Confluence continuation cursor returned by the previous page",
      }),
    ),
  },
  { additionalProperties: false },
);

const getPageParameters = Type.Object(
  {
    page_id: Type.String({ description: "Confluence page id" }),
    body_format: Type.Optional(pageBodyFormat),
    include: Type.Optional(
      Type.Array(
        Type.Union([
          Type.Literal("labels"),
          Type.Literal("properties"),
          Type.Literal("operations"),
          Type.Literal("version"),
          Type.Literal("versions"),
          Type.Literal("children"),
          Type.Literal("attachments"),
          Type.Literal("footer_comments"),
          Type.Literal("inline_comments"),
          Type.Literal("restrictions"),
        ]),
        { uniqueItems: true, description: "Related page data to fetch" },
      ),
    ),
    comment_limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    comment_cursor: Type.Optional(Type.String()),
    markdown: Type.Optional(
      Type.Boolean({ description: "Write a read-only markdown sidecar" }),
    ),
  },
  { additionalProperties: false },
);

const downloadPageParameters = Type.Object(
  {
    page_id: Type.String({ description: "Page id" }),
    body_format: Type.Optional(bodyFormatRead),
    markdown: Type.Optional(
      Type.Boolean({ description: "Write a read-only markdown sidecar" }),
    ),
    attachments: Type.Optional(
      Type.Union([
        Type.Literal("none"),
        Type.Literal("metadata"),
        Type.Literal("download"),
      ]),
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
const manageCommentParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("create"),
      Type.Literal("update"),
      Type.Literal("delete"),
      Type.Literal("resolve"),
      Type.Literal("reopen"),
    ]),
    kind: commentKind,
    page_id: Type.Optional(Type.String({ description: "Required for create" })),
    comment_id: Type.Optional(
      Type.String({ description: "Required for every action except create" }),
    ),
    body: Type.Optional(
      Type.String({ description: "Required for create and update" }),
    ),
    body_representation: Type.Optional(commentRepresentation),
    parent_comment_id: Type.Optional(Type.String()),
    inline_properties: Type.Optional(Type.Record(Type.String(), Type.Any())),
    version_message: Type.Optional(Type.String()),
    allow_stale: Type.Optional(Type.Boolean()),
    dry_run: dryRun,
  },
  { additionalProperties: false },
);
const managePageParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("trash"),
      Type.Literal("restore"),
      Type.Literal("purge"),
    ]),
    page_id: Type.String(),
    dry_run: dryRun,
  },
  { additionalProperties: false },
);
const manageLabelParameters = Type.Object(
  {
    action: Type.Union([Type.Literal("add"), Type.Literal("remove")]),
    page_id: Type.String(),
    label: Type.String(),
    prefix: Type.Optional(
      Type.String({ description: "Used only when adding a label" }),
    ),
    dry_run: dryRun,
  },
  { additionalProperties: false },
);
const restrictionOperation = Type.Union([
  Type.Literal("read"),
  Type.Literal("update"),
]);
const manageRestrictionParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("add"),
      Type.Literal("remove"),
      Type.Literal("clear_operation"),
    ]),
    page_id: Type.String(),
    operation: restrictionOperation,
    subject_type: Type.Optional(
      Type.Union([Type.Literal("user"), Type.Literal("group")], {
        description: "Required for add and remove",
      }),
    ),
    subject_id: Type.Optional(
      Type.String({ description: "Required for add and remove" }),
    ),
    dry_run: dryRun,
  },
  { additionalProperties: false },
);
const manageAttachmentParameters = Type.Object(
  {
    action: Type.Union([
      Type.Literal("upload"),
      Type.Literal("rename"),
      Type.Literal("delete"),
    ]),
    page_id: Type.String(),
    file_path: Type.Optional(
      Type.String({ description: "Required for upload" }),
    ),
    filename: Type.Optional(Type.String()),
    attachment_id: Type.Optional(
      Type.String({ description: "Required for rename and delete" }),
    ),
    new_filename: Type.Optional(
      Type.String({ description: "Required for rename" }),
    ),
    comment: Type.Optional(Type.String()),
    minor_edit: Type.Optional(Type.Boolean()),
    update_existing: Type.Optional(Type.Boolean()),
    status: Type.Optional(pageStatus),
    dry_run: dryRun,
  },
  { additionalProperties: false },
);
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
    parameters: manageAttachmentParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
