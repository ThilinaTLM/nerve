// End to end, as an author would get it: pack extension-api, ui-kit and the SDK, install the
// tarballs with npm, scaffold an `integration` extension with `nerve-ext init`, run
// `nerve-ext check`, and compare dist/ with the fixture the server's tests load; then the same
// for a `preview` extension (UI build, frame files).
//   pnpm --filter @nervekit/extension-sdk e2e
// Needs network for the third-party dependencies (esbuild, vitest, mermaid ...). Not a unit test:
// a cold install takes a minute or more. Set KEEP=1 to keep the temporary folder.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureDist, fixtureId } from "./fixture.ts";

const packages = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = await mkdtemp(join(tmpdir(), "nerve-sdk-e2e-"));

function run(command: string, args: string[], cwd: string): string {
  console.log(`$ ${command} ${args.join(" ")}  (${cwd})`);
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

try {
  // 1. Tarballs.
  const tarballs = join(root, "tarballs");
  await mkdir(tarballs);
  for (const name of ["extension-api", "ui-kit", "extension-sdk"])
    run("pnpm", ["pack", "--pack-destination", tarballs], join(packages, name));
  const files = (await readdir(tarballs)).map((file) => join(tarballs, file));
  assert.equal(
    files.length,
    3,
    `expected three tarballs, got ${files.join(", ")}`,
  );

  // 2. Scaffold with the packed SDK.
  const tools = join(root, "tools");
  await mkdir(tools);
  await writeFile(
    join(tools, "package.json"),
    '{"name":"tools","private":true}\n',
  );
  run("npm", ["install", "--no-audit", "--no-fund", ...files], tools);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const bin = join(tools, "node_modules", ".bin", "nerve-ext");
  run(bin, ["init", fixtureId, "--kind", "integration"], workspace);
  const project = join(workspace, fixtureId);

  // 3. Install the project from the same tarballs (the pinned version is not on npm yet).
  run("npm", ["install", "--no-audit", "--no-fund", ...files], project);
  const pkg = JSON.parse(await readFile(join(project, "package.json"), "utf8"));
  assert.match(
    pkg.dependencies["@nervekit/extension-sdk"],
    /^(\d+\.\d+\.\d+|file:.*)$/,
  );

  // 4. check = tsc + build + validate + vitest.
  console.log(run("npx", ["nerve-ext", "check"], project));

  // 5. The output is what the server's installed-extension tests load.
  const dist = join(project, "dist");
  assert.equal(
    await readFile(join(dist, "backend.js"), "utf8"),
    await readFile(join(fixtureDist, "backend.js"), "utf8"),
  );
  const built = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
  const committed = JSON.parse(
    await readFile(join(fixtureDist, "manifest.json"), "utf8"),
  );
  delete built.sdkVersion;
  delete committed.sdkVersion;
  assert.deepEqual(built, committed);
  // 6. A preview extension: UI build with Vite, the frame's files, and the bridge in a Vitest test.
  run(bin, ["init", "csv-viewer", "--kind", "preview"], workspace);
  const preview = join(workspace, "csv-viewer");
  run("npm", ["install", "--no-audit", "--no-fund", ...files], preview);
  console.log(run("npx", ["nerve-ext", "check"], preview));
  const previewManifest = JSON.parse(
    await readFile(join(preview, "dist", "manifest.json"), "utf8"),
  );
  assert.equal(previewManifest.ui.previews[0].entry, "ui/table/index.html");
  assert.equal(previewManifest.ui.previews[0].edit, "source");
  const frame = await readFile(
    join(preview, "dist", "ui", "table", "index.html"),
    "utf8",
  );
  assert.match(
    frame,
    /<script type="module" crossorigin src="\.\/assets\/[^"]+\.js">/,
  );
  assert.doesNotMatch(frame, /<script(?![^>]*\bsrc=)/);
  console.log("e2e passed");
} finally {
  if (process.env.KEEP) console.log(`kept ${root}`);
  else await rm(root, { recursive: true, force: true });
}
