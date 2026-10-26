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
    space_id: Type.Optional(Type.String()),
    space_key: Type.Optional(
      Type.String({ description: "Defaults from settings." }),
    ),
    title: Type.Optional(Type.String()),
    parent_id: Type.Optional(Type.String()),
    status: Type.Optional(pageStatus),
    body: Type.Optional(
      Type.String({ description: "Mutually exclusive with body_file." }),
    ),
    body_file: Type.Optional(
      Type.String({
        description: "Storage XML/ADF/wiki; not with body.",
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
      Type.String({ description: "Mutually exclusive with body_file." }),
    ),
    body_file: Type.Optional(
      Type.String({
        description: "Storage XML/ADF/wiki; not with body.",
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
    prefix: Type.Optional(Type.String()),
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
    description:
      "List or resolve visible Confluence Cloud spaces. Read {{skill:confluence}} before first use.",
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
      "Find Confluence pages by simple filters or CQL/free-text search. Read {{skill:confluence}} before first use.",
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
      "Fetch a Confluence page and optional related data. Read {{skill:confluence}} before first use.",
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
      "Download editable Confluence page artifacts and optional attachments. Read {{skill:confluence}} before first use.",
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
      "Create a Confluence page. Only when the user explicitly asks. Read {{skill:confluence}} before first use.",
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
      "Update a Confluence page with stale-version protection. Only when the user explicitly asks. Read {{skill:confluence}} before first use.",
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
      "Create, update, delete, resolve, or reopen one Confluence comment. Only when the user explicitly asks. Read {{skill:confluence}} before first use.",
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
      "Trash, restore, or permanently purge one Confluence page; archive is not supported by the API. Only when the user explicitly asks. Read {{skill:confluence}} before first use.",
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
      "Add or remove one label on one Confluence page. Only when the user explicitly asks. Read {{skill:confluence}} before first use.",
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
      "Add or remove one page restriction subject, or explicitly clear one operation. Only when the user explicitly asks. Read {{skill:confluence}} before first use.",
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
      "Upload, rename, or delete one Confluence attachment. Only when the user explicitly asks. Read {{skill:confluence}} before first use.",
    parameters: manageAttachmentParameters,
    executionMode: "sequential",
  },
] satisfies ToolDefinition[];
