export type UnsavedFileChoice = "save" | "discard" | "cancel";

export type DirtyFileCloseTarget = {
  id: string;
  name: string;
};

export async function canCloseDirtyFiles(
  files: DirtyFileCloseTarget[],
  prompt: (files: DirtyFileCloseTarget[]) => Promise<UnsavedFileChoice>,
  save: (id: string) => Promise<boolean>,
): Promise<boolean> {
  if (files.length === 0) return true;
  const choice = await prompt(files);
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  for (const file of files) {
    if (!(await save(file.id))) return false;
  }
  return true;
}
