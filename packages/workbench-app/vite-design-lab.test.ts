import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  designLabBuildPlugin,
  designLabStyles,
  isDesignLabModule,
} from "./vite-design-lab";

const labModule = fileURLToPath(
  new URL("./src/lib/app/design-lab/DesignLab.svelte", import.meta.url),
);

test("production excludes lab sources; dev retains the common source scan", () => {
  const css = readFileSync(
    new URL("./src/styles/app.css", import.meta.url),
    "utf8",
  );
  assert.equal(designLabStyles(css, true), css);
  const dev = designLabStyles(css, false);
  assert.ok(!dev.includes('@source not "../lib/app/design-lab/**";'));
  assert.ok(dev.includes('@source "../**/*.{svelte,ts}";'));
  assert.throws(() => designLabStyles("", true), /explicitly exclude/);
});

test("gitignored wireframes receive an explicit directory source only in dev", () => {
  const css =
    '@source "../**/*.{svelte,ts}";\n@source not "../lib/app/design-lab/**";';
  const wireframeSource = '@source "../lib/app/design-lab/wireframes";';
  assert.ok(designLabStyles(css, false).includes(wireframeSource));
  assert.ok(!designLabStyles(css, true).includes(wireframeSource));
  assert.ok(
    designLabStyles(css, true).includes(
      '@source not "../lib/app/design-lab/**";',
    ),
  );
});

test("module boundary covers fixtures, queries and normalized Windows ids", () => {
  assert.ok(isDesignLabModule(labModule));
  assert.ok(isDesignLabModule(`${labModule}?svelte&type=style&lang.css`));
  assert.ok(isDesignLabModule(labModule.replaceAll("/", "\\")));
  assert.ok(
    isDesignLabModule(labModule.replace("DesignLab.svelte", "fixtures/a.ts")),
  );
  assert.ok(
    !isDesignLabModule(labModule.replace("design-lab/", "design-lab-other/")),
  );
  assert.ok(
    !isDesignLabModule("/other/src/lib/app/design-lab/DesignLab.svelte"),
  );
});

test("wireframe file events update app CSS while preserving existing HMR modules", () => {
  const update = designLabBuildPlugin().hotUpdate;
  assert.equal(typeof update, "function");
  if (typeof update !== "function") return;
  const stylesheet = fileURLToPath(
    new URL("./src/styles/app.css", import.meta.url),
  );
  const cssModule = { id: stylesheet };
  const componentModule = { id: labModule };
  const context = {
    environment: {
      moduleGraph: {
        getModulesByFile(file: string) {
          assert.equal(file, stylesheet);
          return new Set([cssModule]);
        },
      },
    },
  } as never;
  const prototype = labModule.replace(
    "DesignLab.svelte",
    "wireframes/new-prototype.svelte",
  );
  assert.deepEqual(
    update.call(context, { file: prototype, modules: [] } as never),
    [cssModule],
  );
  assert.deepEqual(
    update.call(context, {
      file: prototype,
      modules: [componentModule],
    } as never),
    [componentModule, cssModule],
  );
  for (const type of ["create", "update", "delete"]) {
    assert.deepEqual(
      update.call(context, {
        type,
        file: prototype,
        modules: [componentModule, cssModule],
      } as never),
      [componentModule, cssModule],
    );
  }
  assert.equal(
    update.call(context, {
      file: labModule,
      modules: [componentModule],
    } as never),
    undefined,
  );
  assert.equal(
    update.call(context, {
      file: prototype.replace(".svelte", ".md"),
      modules: [],
    } as never),
    undefined,
  );
});

test("bundle guard rejects emitted lab modules only when Vite is production", () => {
  const plugin = designLabBuildPlugin();
  const configure = plugin.configResolved;
  const guard = plugin.generateBundle;
  assert.equal(typeof configure, "function");
  assert.equal(typeof guard, "function");
  if (typeof configure !== "function" || typeof guard !== "function") return;
  const context = {
    error(message: string): never {
      throw new Error(message);
    },
  } as never;
  const bundle = {
    "app.js": {
      type: "chunk",
      fileName: "app.js",
      modules: { [labModule]: {} },
    },
    "app.css": { type: "asset", fileName: "app.css" },
  } as never;

  // --mode development still has DEV=false unless NODE_ENV is overridden.
  configure.call(context, { isProduction: true, mode: "development" } as never);
  assert.throws(
    () => guard.call(context, {} as never, bundle, false),
    /Design Lab modules leaked into production chunk app.js/,
  );
  guard.call(
    context,
    {} as never,
    {
      "app.js": { type: "chunk", fileName: "app.js", modules: {} },
    } as never,
    false,
  );
  configure.call(context, { isProduction: false, mode: "production" } as never);
  guard.call(context, {} as never, bundle, false);
});
