export type AdfDocument = {
  type: "doc";
  version: 1;
  content: AdfNode[];
};

type AdfNode = Record<string, unknown>;
