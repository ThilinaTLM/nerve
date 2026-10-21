import { Type } from "typebox";
import { executeEdit } from "../../../execution/filesystem/edit.js";
import { executeFind } from "../../../execution/filesystem/find.js";
import { executeLs } from "../../../execution/filesystem/list.js";
import { executeRead } from "../../../execution/filesystem/read.js";
import { executeGrep } from "../../../execution/filesystem/search.js";
import { executeWrite } from "../../../execution/filesystem/write.js";
import type { ToolDefinition } from "../../contracts.js";

const readParameters = Type.Object(
  {
    path: Type.String({
      description: "Relative or absolute.",
    }),
    offset: Type.Optional(
      Type.Number({
        description: "1-indexed line.",
      }),
    ),
    limit: Type.Optional(Type.Number()),
    byteOffset: Type.Optional(
      Type.Number({
        description: "0-indexed; not with offset/limit.",
      }),
    ),
    byteLimit: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

const editItemParameters = Type.Object(
  {
    oldText: Type.String({
      minLength: 1,
    }),
    newText: Type.String(),
  },
  { additionalProperties: false },
);

const editParameters = Type.Object(
  {
    path: Type.String(),
    edits: Type.Array(editItemParameters, {
      minItems: 1,
    }),
  },
  { additionalProperties: false },
);

const writeParameters = Type.Object(
  {
    path: Type.String(),
    content: Type.String(),
  },
  { additionalProperties: false },
);

const grepParameters = Type.Object(
  {
    pattern: Type.String(),
    path: Type.Optional(Type.String()),
    paths: Type.Optional(
      Type.Array(Type.String(), {
        description: "Several targets instead of path.",
      }),
    ),
    glob: Type.Optional(
      Type.String({
        description: "E.g. **/*.ts.",
      }),
    ),
    ignoreCase: Type.Optional(Type.Boolean()),
    literal: Type.Optional(Type.Boolean()),
    context: Type.Optional(
      Type.Number({
        description: "Lines around each match.",
      }),
    ),
    limit: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

const findParameters = Type.Object(
  {
    pattern: Type.String({
      description: "E.g. src/**/*.test.ts.",
    }),
    path: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

const lsParameters = Type.Object(
  {
    path: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);
export const filesystemToolDefinitions = [
  {
    name: "read",
    group: "fileInspection",
    baseRisk: "read",
    permission: {
      durableAllow: "target",
      targets: [
        {
          kind: "path",
          access: "read",
          scope: "exact",
          arguments: ["path"],
        },
      ],
    },
    traits: [],
    executionKind: "local",
    executor: executeRead,
    label: "read",
    description:
      "Read a text file or image. Text output is bounded; page with offset/limit, or byteOffset/byteLimit for long lines.",
    parameters: readParameters,
    executionMode: "parallel",
  },
  {
    name: "edit",
    group: "fileEditing",
    baseRisk: "workspace_write",
    permission: {
      durableAllow: "target",
      targets: [
        {
          kind: "path",
          access: "write",
          scope: "exact",
          arguments: ["path"],
        },
      ],
    },
    traits: ["write_capable"],
    executionKind: "local",
    executor: executeEdit,
    label: "edit",
    description:
      "Replace exact, unique text in an existing file; all edits resolve against the original content.",
    parameters: editParameters,
    executionMode: "sequential",
  },
  {
    name: "write",
    group: "fileEditing",
    baseRisk: "workspace_write",
    permission: {
      durableAllow: "target",
      targets: [
        {
          kind: "path",
          access: "write",
          scope: "exact",
          arguments: ["path"],
        },
      ],
    },
    traits: ["write_capable"],
    executionKind: "local",
    executor: executeWrite,
    label: "write",
    description: "Create or overwrite a file, creating parent directories.",
    parameters: writeParameters,
    executionMode: "sequential",
  },
  {
    name: "grep",
    group: "fileInspection",
    baseRisk: "read",
    permission: {
      durableAllow: "target",
      targets: [
        {
          kind: "path",
          access: "read",
          scope: "tree",
          arguments: ["paths", "path"],
          defaultValue: ".",
        },
      ],
    },
    traits: [],
    executionKind: "local",
    executor: executeGrep,
    label: "grep",
    description:
      "Search file contents by regex or literal string; results are bounded.",
    parameters: grepParameters,
    executionMode: "parallel",
  },
  {
    name: "find",
    group: "fileInspection",
    baseRisk: "read",
    permission: {
      durableAllow: "target",
      targets: [
        {
          kind: "path",
          access: "read",
          scope: "tree",
          arguments: ["path"],
          defaultValue: ".",
        },
      ],
    },
    traits: [],
    executionKind: "local",
    executor: executeFind,
    label: "find",
    description:
      "Find files by glob; respects .gitignore; results are bounded.",
    parameters: findParameters,
    executionMode: "parallel",
  },
  {
    name: "ls",
    group: "fileInspection",
    baseRisk: "read",
    permission: {
      durableAllow: "target",
      targets: [
        {
          kind: "path",
          access: "read",
          scope: "tree",
          arguments: ["path"],
          defaultValue: ".",
        },
      ],
    },
    traits: [],
    executionKind: "local",
    executor: executeLs,
    label: "ls",
    description: "List a directory, including dotfiles.",
    parameters: lsParameters,
    executionMode: "parallel",
  },
] satisfies ToolDefinition[];
