import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDroppedFiles } from "./dropped-files";

function deps(
  overrides: Partial<Parameters<typeof resolveDroppedFiles>[1]> = {},
) {
  const errors: string[] = [];
  const infos: string[] = [];
  return {
    errors,
    infos,
    deps: {
      upload: async (file: File) => `/up/${file.name}`,
      notifyError: (title: string, description?: string) =>
        errors.push(`${title}: ${description}`),
      notifyInfo: (message: string) => infos.push(message),
      ...overrides,
    },
  };
}

const folder = Object.assign(new File([""], "dir"), {
  slice: () => ({ arrayBuffer: () => Promise.reject(new Error("dir")) }),
}) as File;

test("browser drops upload files, skip folders with one notice, report failures", async () => {
  const ctx = deps({
    upload: async (file: File) => {
      if (file.name === "big.bin") throw new Error("File exceeds 20 MiB");
      return `/up/${file.name}`;
    },
  });
  const paths = await resolveDroppedFiles(
    [new File(["a"], "a.txt"), folder, new File(["b"], "big.bin")],
    ctx.deps,
  );
  assert.deepEqual(paths, ["/up/a.txt"]);
  assert.deepEqual(ctx.infos, [
    "Folders can only be dropped in the desktop app",
  ]);
  assert.deepEqual(ctx.errors, [
    "Could not attach big.bin: File exceeds 20 MiB",
  ]);
});

test("desktop drops use native paths and never upload", async () => {
  const ctx = deps({
    getPathForFile: (file) => `/proj/src/${file.name}`,
    projectDir: "/proj",
    upload: async () => {
      throw new Error("must not upload");
    },
  });
  const paths = await resolveDroppedFiles([new File(["a"], "a.ts")], ctx.deps);
  assert.deepEqual(paths, ["src/a.ts"]);
});
