import { closeSync, fsyncSync, openSync } from "node:fs";

export function syncFile(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Directory sync is unsupported by Windows; file bytes are still synced there. */
export function syncDirectory(path: string): void {
  if (process.platform === "win32") return;
  syncFile(path);
}
