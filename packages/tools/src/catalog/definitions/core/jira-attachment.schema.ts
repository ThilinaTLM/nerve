import { Type } from "typebox";

export const jiraManageAttachmentParameters = Type.Object(
  {
    action: Type.Enum(["upload", "delete"]),
    issue_key: Type.Optional(
      Type.String({ description: "Required for upload" }),
    ),
    file_path: Type.Optional(
      Type.String({ description: "Required for upload" }),
    ),
    filename: Type.Optional(Type.String()),
    attachment_id: Type.Optional(
      Type.String({ description: "Required for delete" }),
    ),
    dry_run: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
