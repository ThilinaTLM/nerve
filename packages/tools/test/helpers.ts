import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after } from "node:test";

export type TempProject = {
  root: string;
  write: (relativePath: string, content: string) => Promise<string>;
  cleanup: () => Promise<void>;
};

export async function createTempProject(
  prefix = "nerve-tools-",
): Promise<TempProject> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const cleanup = () => rm(root, { recursive: true, force: true });
  after(cleanup);
  return {
    root,
    cleanup,
    async write(relativePath, content) {
      const path = join(root, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
      return path;
    },
  };
}

export async function withPath<T>(
  path: string,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = process.env.PATH;
  process.env.PATH = path;
  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previous;
    }
  }
}

export async function writeExecutable(
  directory: string,
  name: string,
  body: string,
): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, `#!${process.execPath}\n${body}`, "utf8");
  await chmod(path, 0o755);
  return path;
}
