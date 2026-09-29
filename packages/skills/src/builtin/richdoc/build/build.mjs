import { build, transform } from "esbuild";
import { compile } from "svelte/compiler";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const root = resolve(import.meta.dirname, "..");
const packagedRoot = resolve(root, "../../../dist/builtin/richdoc");
const require = createRequire(import.meta.url);
const generated = [
  "scripts/richdoc.mjs",
  "assets",
  "references/elements.md",
  "THIRD_PARTY_NOTICES.md",
];
const hash = (data) => createHash("sha256").update(data).digest("hex");
const svelte = {
  name: "svelte-icons",
  setup(builder) {
    builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
      contents: compile(await readFile(path, "utf8"), {
        filename: path,
        generate: "client",
        dev: false,
      }).js.code,
      loader: "js",
      resolveDir: dirname(path),
    }));
  },
};
async function files(root, prefix = "") {
  const found = [];
  for (const entry of (
    await readdir(join(root, prefix), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await files(root, name)));
    else found.push(name);
  }
  return found;
}
async function packageRoot(path) {
  let dir = dirname(path);
  while (dir !== dirname(dir)) {
    try {
      const manifest = JSON.parse(
        await readFile(join(dir, "package.json"), "utf8"),
      );
      if (manifest.name && manifest.version) return dir;
    } catch {
      /* Continue through nested package scope markers. */
    }
    dir = dirname(dir);
  }
  throw new Error(`No package manifest for ${path}`);
}
export async function generate(destination) {
  await mkdir(destination, { recursive: true });
  await rm(join(destination, "assets"), { recursive: true, force: true });
  const inputs = new Set();
  const common = {
    absWorkingDir: root,
    bundle: true,
    minify: true,
    legalComments: "none",
    metafile: true,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
  };
  async function bundle(entry, output, browser, name) {
    await mkdir(dirname(join(destination, output)), { recursive: true });
    const result = await build({
      ...common,
      entryPoints: [entry],
      outfile: join(destination, output),
      platform: browser ? "browser" : "node",
      format: browser ? "iife" : "esm",
      target: browser ? "es2022" : "node24",
      ...(name ? { globalName: name } : {}),
      plugins: browser ? [svelte] : [],
      conditions: browser ? ["browser"] : ["node"],
    });
    for (const input of Object.keys(result.metafile.inputs))
      if (input.includes("node_modules")) inputs.add(resolve(root, input));
  }
  await bundle("src/cli/main.ts", "scripts/richdoc.mjs", false);
  await bundle("src/browser/main.ts", "assets/richdoc.js", true);
  for (const vendor of ["code", "math", "diagram", "chart", "icon"])
    await bundle(
      `src/browser/vendors/${vendor}.ts`,
      `assets/vendor/${vendor}.js`,
      true,
      `Richdoc_${vendor}`,
    );
  const katexRoot = await packageRoot(require.resolve("katex"));
  inputs.add(join(katexRoot, "dist/katex.js"));
  const mathCss = (
    await readFile(join(katexRoot, "dist/katex.css"), "utf8")
  ).replaceAll("url(fonts/", "url(../fonts/");
  await writeFile(
    join(destination, "assets/vendor/math.css"),
    (await transform(mathCss, { loader: "css", minify: true })).code,
  );
  await cp(join(katexRoot, "dist/fonts"), join(destination, "assets/fonts"), {
    recursive: true,
  });
  await writeFile(
    join(destination, "assets/richdoc.css"),
    (
      await transform(
        await readFile(join(root, "src/styles/richdoc.css"), "utf8"),
        { loader: "css", minify: true },
      )
    ).code,
  );
  const schemaFile = join(destination, "schema.mjs");
  await build({
    ...common,
    entryPoints: ["src/schema/index.ts"],
    outfile: schemaFile,
    format: "esm",
    platform: "node",
  });
  const { ELEMENTS, VERSION } = await import(pathToFileURL(schemaFile).href);
  const manifest = { version: VERSION, files: {} };
  for (const name of await files(join(destination, "assets"))) {
    const data = await readFile(join(destination, "assets", name));
    manifest.files[name] = { sha256: hash(data), bytes: data.length };
  }
  await writeFile(
    join(destination, "assets/manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await mkdir(join(destination, "references"), { recursive: true });
  const reference = [
    "# Richdoc element reference",
    "",
    "Generated from the skill's canonical schema. Use native semantic HTML for everything else.",
    "",
  ];
  for (const [tag, spec] of Object.entries(ELEMENTS)) {
    reference.push(`## \`${tag}\``, "", spec.description, "");
    for (const [attribute, rule] of Object.entries(spec.attributes))
      reference.push(
        `- \`${attribute}\`${rule.required ? " (required)" : ""}: ${rule.description}${rule.values ? ` — ${rule.values.map((v) => `\`${v}\``).join(", ")}` : ""}.`,
      );
    reference.push("", "```html", spec.example, "```", "");
  }
  await writeFile(
    join(destination, "references/elements.md"),
    reference.join("\n"),
  );
  const packages = new Map();
  for (const input of [...inputs].sort()) {
    const dir = await packageRoot(input);
    const manifest = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8"),
    );
    const key = `${manifest.name}@${manifest.version}`;
    if (packages.has(key)) continue;
    const names = (await readdir(dir))
      .filter((n) => /^(?:license|licence|copying|notice)(?:[.-].*)?$/i.test(n))
      .sort();
    const notices = [];
    for (const name of names) {
      try {
        notices.push(`${name}\n\n${await readFile(join(dir, name), "utf8")}`);
      } catch {
        /* Directories are not notice files. */
      }
    }
    if (!notices.length) throw new Error(`Missing license notice: ${key}`);
    packages.set(key, { license: manifest.license ?? "See notice", notices });
  }
  const notice = [
    "# Bundled dependency notices",
    "",
    "Original skill source is Apache-2.0. The following notices cover dependencies embedded in the executable and browser assets, including their transitive dependencies.",
    "",
  ];
  for (const [name, metadata] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  ))
    notice.push(
      `## ${name}`,
      "",
      `Declared license: ${typeof metadata.license === "string" ? metadata.license : JSON.stringify(metadata.license)}`,
      "",
      "```text",
      metadata.notices.join("\n\n"),
      "```",
      "",
    );
  await writeFile(
    join(destination, "THIRD_PARTY_NOTICES.md"),
    notice.join("\n"),
  );
  await rm(schemaFile);
  return Object.values(manifest.files).reduce(
    (sum, file) => sum + file.bytes,
    0,
  );
}

export async function verifyBudget(assetBytes, update = false) {
  const budgetPath = join(root, "build/budget.json");
  const baseline = JSON.parse(await readFile(budgetPath, "utf8")).assetBytes;
  if (assetBytes > baseline * 1.1 && !update)
    throw new Error(
      `Asset size ${assetBytes} exceeds baseline ${baseline} by more than 10%.`,
    );
  if (update)
    await writeFile(budgetPath, JSON.stringify({ assetBytes }, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const check = process.argv.includes("--check"),
    updateBudget = process.argv.includes("--update-budget");
  const stagingBase = check ? tmpdir() : resolve(packagedRoot, "../..");
  await mkdir(stagingBase, { recursive: true });
  const staging = await mkdtemp(join(stagingBase, ".richdoc-build-"));
  try {
    const assetBytes = await generate(staging);
    await verifyBudget(assetBytes, updateBudget);
    if (!check) {
      await cp(root, staging, {
        recursive: true,
        filter: (path) =>
          !path
            .split(/[\\/]/)
            .some((part) =>
              ["node_modules", ".cache", ".gitignore"].includes(part),
            ),
      });
    }
    for (const item of generated) {
      const names =
        item === "assets"
          ? (await files(join(staging, item))).map((n) => `${item}/${n}`)
          : [item];
      if (check) {
        if (
          item === "assets" &&
          JSON.stringify(await files(join(packagedRoot, item))) !==
            JSON.stringify(await files(join(staging, item)))
        )
          throw new Error("Generated asset inventory differs.");
        for (const name of names)
          if (
            hash(await readFile(join(packagedRoot, name))) !==
            hash(await readFile(join(staging, name)))
          )
            throw new Error(`Stale generated file: ${name}`);
      }
    }
    if (!check) {
      await mkdir(dirname(packagedRoot), { recursive: true });
      await rm(packagedRoot, { recursive: true, force: true });
      await rename(staging, packagedRoot);
    }
    console.log(
      `${check ? "Verified" : "Built"} self-contained richdoc (${assetBytes} asset bytes).`,
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
