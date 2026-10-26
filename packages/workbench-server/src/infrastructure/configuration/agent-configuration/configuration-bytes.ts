import { readFile } from "node:fs/promises";
import { digestBytes } from "../scoped-store/scoped-document-store.js";

export async function readConfigurationDigest(file: string): Promise<string> {
  try {
    return digestBytes(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}
