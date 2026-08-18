import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type SearchFindFixture = {
  root: string;
  symlinksSupported: boolean;
  grepCases: readonly SearchFindGrepCase[];
  findCases: readonly SearchFindFindCase[];
};

export type SearchFindGrepCase = {
  name: string;
  args: Record<string, unknown>;
};

export type SearchFindFindCase = {
  name: string;
  args: Record<string, unknown>;
};

export async function createSearchFindFixture(
  root: string,
  scale = 20,
): Promise<SearchFindFixture> {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  await text(root, "small/src/alpha.ts", "Needle alpha\ncontext line\n");
  await text(root, "small/src/beta.ts", "needle beta\n");
  await text(root, "small/README.md", "needle docs\n");
  await text(root, "small/.hidden.ts", "needle hidden\n");

  await text(
    root,
    "monorepo/.gitignore",
    "generated/*\n!packages/package-000/generated/keep.ts\n*.ignored\n",
  );
  await text(root, "monorepo/.ignore", "from-ignore.txt\n");
  await text(root, "monorepo/.rgignore", "from-rgignore.txt\n");
  for (let index = 0; index < Math.max(1, scale); index += 1) {
    const packageName = `package-${String(index).padStart(3, "0")}`;
    await text(
      root,
      `monorepo/packages/${packageName}/src/index.ts`,
      `export const value${index} = "fixture needle ${index}";\n`,
    );
    await text(
      root,
      `monorepo/packages/${packageName}/src/helper.test.ts`,
      `test("needle ${index}", () => {});\n`,
    );
    await text(
      root,
      `monorepo/packages/${packageName}/generated/output.ts`,
      "needle generated\n",
    );
  }
  await text(
    root,
    "monorepo/packages/package-000/generated/keep.ts",
    "needle explicitly included\n",
  );
  await text(root, "monorepo/packages/nested/.gitignore", "private.ts\n");
  await text(root, "monorepo/packages/nested/public.ts", "needle public\n");
  await text(root, "monorepo/packages/nested/private.ts", "needle private\n");
  await text(root, "monorepo/root.ignored", "needle ignored\n");
  await text(root, "monorepo/from-ignore.txt", "needle ignored\n");
  await text(root, "monorepo/from-rgignore.txt", "needle ignored\n");
  await text(root, "monorepo/.hidden/visible.txt", "needle hidden\n");

  await text(root, "edge/context.txt", "before\nneedle\nafter\n");
  await text(root, "edge/mixed.txt", "first\r\nneedle crlf\nlast\r\n");
  await text(root, "edge/long.txt", `${"x".repeat(24_000)}needle\n`);
  await bytes(root, "edge/binary.bin", Buffer.from([0x6e, 0x65, 0x65, 0x00]));
  await bytes(
    root,
    "edge/invalid.txt",
    Buffer.from([0xff, 0xfe, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x0a]),
  );
  await text(root, "edge/disappearing.txt", "needle race\n");

  let symlinksSupported = true;
  try {
    await symlink("context.txt", join(root, "edge", "context-link.txt"));
    await symlink("missing.txt", join(root, "edge", "broken-link.txt"));
    await mkdir(join(root, "edge", "cycle"), { recursive: true });
    await symlink("..", join(root, "edge", "cycle", "parent"), "dir");
  } catch {
    symlinksSupported = false;
  }

  return {
    root,
    symlinksSupported,
    grepCases: [
      {
        name: "small-literal",
        args: { path: "small", pattern: "needle", literal: true },
      },
      {
        name: "small-case-glob",
        args: {
          path: "small",
          pattern: "needle",
          ignoreCase: true,
          glob: "**/*.ts",
        },
      },
      {
        name: "context",
        args: { path: "edge/context.txt", pattern: "needle", context: 1 },
      },
      {
        name: "nested-ignores",
        args: { path: "monorepo", pattern: "needle", literal: true },
      },
      {
        name: "encoding-and-binary",
        args: { path: "edge", pattern: "needle", literal: true },
      },
      {
        name: "bounded",
        args: { path: "monorepo", pattern: "needle", limit: 5 },
      },
    ],
    findCases: [
      {
        name: "small-typescript",
        args: { path: "small", pattern: "src/*.ts" },
      },
      {
        name: "nested-path-glob",
        args: { path: "monorepo", pattern: "packages/*/src/*.ts" },
      },
      {
        name: "ignored-files",
        args: { path: "monorepo", pattern: "*.ignored" },
      },
      {
        name: "bounded",
        args: { path: "monorepo", pattern: "**/*.ts", limit: 5 },
      },
    ],
  };
}

async function text(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  await bytes(root, path, Buffer.from(content, "utf8"));
}

async function bytes(
  root: string,
  path: string,
  content: Buffer,
): Promise<void> {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}
