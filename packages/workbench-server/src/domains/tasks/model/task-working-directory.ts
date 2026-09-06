import path from "node:path";

export function resolveTaskWorkingDirectory(
  input: string,
  baseDirectory?: string,
): string {
  const inputFlavor = pathFlavor(input);
  if (inputFlavor.isAbsolute(input)) return inputFlavor.resolve(input);
  if (!baseDirectory) {
    throw new Error("Task working directory must be an absolute path");
  }

  const baseFlavor = pathFlavor(baseDirectory);
  if (!baseFlavor.isAbsolute(baseDirectory)) {
    throw new Error("Task working directory base must be an absolute path");
  }
  return baseFlavor.resolve(baseDirectory, input);
}

function pathFlavor(input: string): typeof path.posix | typeof path.win32 {
  return /^[A-Za-z]:[\\/]/.test(input) || input.startsWith("\\")
    ? path.win32
    : path.posix;
}
