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
} from "../../../execution/confluence/confluence.js";
import type { ToolDefinition } from "../../contracts.js";

const stringArray = () => Type.Array(Type.String());
const bodyFormatRead = Type.Enum(["storage", "atlas_doc_format"]);
const pageBodyFormat = Type.Enum(["storage", "atlas_doc_format", "view", "export_view", "anonymous_export_view", "styled_view", "editor"]);
const writeBodyRepresentation = Type.Enum(["storage", "atlas_doc_format", "wiki"]);
const pageStatus = Type.Enum(["current", "draft"]);

const searchSpacesParameters = Type.Object(
  {
    keys: Type.Optional(stringArray()),
    ids: Type.Optional(stringArray()),
    limit: Type.Optional(
      Type.Number({
        minimum: 1,
        maximum: 100,
      }),
    ),
    cursor: Type.Optional(
      Type.String({
        description: "From the preceding page.",
      }),
    ),
  },
  { additionalProperties: false },
);

const searchPagesParameters = Type.Object(
  {
    cql: Type.Optional(Type.String()),
    query: Type.Optional(Type.String()),
    space_key: Type.Optional(Type.String()),
    space_id: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    body_format: Type.Optional(bodyFormatRead),
    limit: Type.Optional(
      Type.Number({
        minimum: 1,
        maximum: 100,
      }),
    ),
    cursor: Type.Optional(
      Type.String({
        description: "From the preceding page.",
      }),
    ),
  },
  { additionalProperties: false },
);

const getPageParameters = Type.Object(
  {
    page_id: Type.String(),
    body_format: Type.Optional(pageBodyFormat),
    include: Type.Optional(
      Type.Array(
        Type.Enum(["labels", "properties", "operations", "version", "versions", "children", "attachments", "footer_comments", "inline_comments", "restrictions"]),
        { uniqueItems: true },
      ),
    ),
    comment_limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    comment_cursor: Type.Optional(Type.String()),
    markdown: Type.Optional(
      Type.Boolean({ description: "Read-only sidecar." }),
    ),
  },
  { additionalProperties: false },
);

const downloadPageParameters = Type.Object(
  {
    page_id: Type.String(),
    body_format: Type.Optional(bodyFormatRead),
    markdown: Type.Optional(
      Type.Boolean({ description: "Read-only sidecar." }),
    ),
    attachments: Type.Optional(
      Type.Enum(["none", "metadata", "download"]),
    ),
  },
  { additionalProperties: false },
);

const createPageParameters = Type.Object(
  {
    space_id: Type.Optional(Type.String()),
    space_key: Type.Optional(
      Type.String({ description: "Defaults from settings." }),
    ),
    title: Type.Optional(Type.String()),
    parent_id: Type.Optional(Type.String()),
    status: Type.Optional(pageStatus),
    body: Type.Optional(
      Type.String({ description: "Not with body_file." }),
    ),
    body_file: Type.Optional(
      Type.String({
        description: "Path to storage XML/ADF/wiki content.",
      }),
    ),
    page_file: Type.Optional(
      Type.String({ description: "Path to one page JSON/JSONL row." }),
    ),
    body_representation: Type.Optional(writeBodyRepresentation),
    dry_run: Type.Optional(Type.Boolean()),
    return_page: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const updatePageParameters = Type.Object(
  {
    page_id: Type.Optional(Type.String()),
    page_file: Type.Optional(
      Type.String({ description: "Path to one page JSON/JSONL row." }),
    ),
    title: Type.Optional(Type.String()),
    parent_id: Type.Optional(Type.String()),
    status: Type.Optional(pageStatus),
    body: Type.Optional(
      Type.String({ description: "Not with body_file." }),
    ),
    body_file: Type.Optional(
      Type.String({
        description: "Path to storage XML/ADF/wiki content.",
      }),
    ),
    body_representation: Type.Optional(writeBodyRepresentation),
    version_message: Type.Optional(Type.String()),
    allow_stale: Type.Optional(
      Type.Boolean({
        description: "Overrides stale-version protection.",
      }),
    ),
    dry_run: Type.Optional(Type.Boolean()),
    return_page: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const dryRun = Type.Optional(Type.Boolean());
const commentKind = Type.Enum(["footer", "inline"]);
const commentRepresentation = Type.Enum(["storage", "atlas_doc_format"]);
const manageCommentParameters = Type.Object(
  {
    action: Type.Enum(["create", "update", "delete", "resolve", "reopen"]),
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
    action: Type.Enum(["trash", "restore", "purge"]),
    page_id: Type.String(),
    dry_run: dryRun,
  },
  { additionalProperties: false },
);
const manageLabelParameters = Type.Object(
  {
    action: Type.Enum(["add", "remove"]),
    page_id: Type.String(),
    label: Type.String(),
    prefix: Type.Optional(Type.String()),
    dry_run: dryRun,
  },
  { additionalProperties: false },
);
const restrictionOperation = Type.Enum(["read", "update"]);
const manageRestrictionParameters = Type.Object(
  {
    action: Type.Enum(["add", "remove", "clear_operation"]),
    page_id: Type.String(),
    operation: restrictionOperation,
    subject_type: Type.Optional(
      Type.Enum(["user", "group"], {
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
    action: Type.Enum(["upload", "rename", "delete"]),
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
    description:
      "List or resolve visible Confluence Cloud spaces.",
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
      "Fetch a Confluence page and optional related data.",
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
      "Download editable Confluence page artifacts and optional attachments.",
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
      "Create a Confluence page. Only on explicit user request.",
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
      "Update a Confluence page with stale-version protection. Only on explicit user request.",
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
      "Create, update, delete, resolve, or reopen one Confluence comment. Only on explicit user request.",
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
      "Trash, restore, or permanently purge one Confluence page; archive is not supported by the API. Only on explicit user request.",
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
    description:
      "Add or remove one label on one Confluence page. Only on explicit user request.",
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
      "Add or remove one page restriction subject, or explicitly clear one operation. Only on explicit user request.",
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
    description:
      "Upload, rename, or delete one Confluence attachment. Only on explicit user request.",
    parameters: manageAttachmentParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
