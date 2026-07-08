export type FileMutation = {
  path: string;
  action: "stage" | "unstage" | "discard";
};
