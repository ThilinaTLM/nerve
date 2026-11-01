import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { legacyColorThemes } from "@nervekit/contracts/settings";
import { compileModule } from "svelte/compiler";
import ts from "typescript";

async function loadAppearance() {
  const source = ts.transpileModule(
    await readFile(new URL("./appearance.svelte.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
  const code = compileModule(source, {
    filename: "appearance.svelte.js",
    generate: "client",
  })
    .js.code.replace(
      /(['"])svelte\/internal\/client\1/g,
      JSON.stringify(import.meta.resolve("svelte/internal/client")),
    )
    .replace(
      '"@nervekit/contracts/settings"',
      JSON.stringify(import.meta.resolve("@nervekit/contracts/settings")),
    )
    .replace(
      /import \{ mode, setMode, userPrefersMode \} from "mode-watcher";/,
      'const mode = globalThis.__mode; const setMode = () => {}; const userPrefersMode = { current: "system" };',
    );
  return (await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  )) as typeof import("./appearance.svelte");
}

test("light and dark themes persist, migrate the legacy key, and sync other tabs without writeback", async (t) => {
  const values = new Map<string, string>();
  let writes = 0;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes++;
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const target = new EventTarget();
  const root = {
    dataset: {} as Record<string, string>,
    classList: { contains: () => false },
  };
  const modeState = { current: "light" as "light" | "dark" | undefined };
  const globals = {
    __mode: modeState,
    localStorage: storage,
    document: { documentElement: root },
    window: {
      localStorage: storage,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const appearance = await loadAppearance();

  const legacyCases: [string, { light: string; dark: string }][] = [
    ...Object.entries(legacyColorThemes),
    ["invalid", { light: "nerve-light", dark: "nerve-dark" }],
  ];
  for (const [legacy, pair] of legacyCases) {
    values.clear();
    values.set("nerve-color-theme", legacy);
    const loaded = appearance.loadAppearancePreference();
    assert.equal(loaded.lightTheme, pair.light, `legacy ${legacy} light`);
    assert.equal(loaded.darkTheme, pair.dark, `legacy ${legacy} dark`);
    assert.equal(values.has("nerve-color-theme"), false, "legacy key removed");
    assert.equal(values.get("nerve-light-theme"), pair.light);
    assert.equal(values.get("nerve-dark-theme"), pair.dark);
  }

  // New keys win over the legacy key; a theme of the wrong kind is rejected.
  values.clear();
  values.set("nerve-light-theme", "nerve-dark");
  values.set("nerve-dark-theme", "graphite");
  assert.deepEqual(
    {
      ...appearance.loadAppearancePreference(),
      colorMode: undefined,
    },
    { lightTheme: "nerve-light", darkTheme: "graphite", colorMode: undefined },
  );

  // The resolved mode selects which slot applies to the document.
  appearance.applyAppearance(
    { lightTheme: "nerve-light", darkTheme: "nerve-dark" },
    "system",
  );
  assert.equal(root.dataset.theme, "nerve-light");
  appearance.setDarkTheme("graphite");
  assert.equal(appearance.appearanceState.darkTheme, "graphite");
  assert.equal(values.get("nerve-dark-theme"), "graphite");
  assert.equal(root.dataset.theme, "nerve-light", "light mode ignores dark");
  modeState.current = "dark";
  appearance.setColorMode("dark");
  assert.equal(root.dataset.theme, "graphite");
  appearance.setLightTheme("nerve-light");
  assert.equal(values.get("nerve-light-theme"), "nerve-light");
  assert.equal(root.dataset.theme, "graphite", "dark mode ignores light");

  const dispose = appearance.installAppearanceStorageSync();
  assert.equal(appearance.installAppearanceStorageSync(), dispose);
  t.after(dispose);
  const emit = (key: string | null, newValue: string | null) => {
    target.dispatchEvent(
      Object.assign(new Event("storage"), {
        key,
        newValue,
        storageArea: storage,
      }),
    );
  };
  const before = writes;
  emit("nerve-dark-theme", "nerve-dark");
  assert.equal(appearance.appearanceState.darkTheme, "nerve-dark");
  assert.equal(root.dataset.theme, "nerve-dark");
  assert.equal(writes, before, "storage events never write back");
  emit("nerve-dark-theme", "nerve-light");
  assert.equal(appearance.appearanceState.darkTheme, "nerve-dark");
  emit("nerve-light-theme", "nerve-dark");
  assert.equal(appearance.appearanceState.lightTheme, "nerve-light");
  emit("unrelated", "graphite");
  emit("nerve-dark-theme", "graphite");
  assert.equal(root.dataset.theme, "graphite");
  emit(null, null);
  assert.equal(appearance.appearanceState.darkTheme, "nerve-dark");
  dispose();
  emit("nerve-dark-theme", "graphite");
  assert.equal(appearance.appearanceState.darkTheme, "nerve-dark");
});

test("pre-paint bootstrap resolves the theme for the stored or system mode", async () => {
  const { runInNewContext } = await import("node:vm");
  const html = await readFile(
    new URL("../../../../index.html", import.meta.url),
    "utf8",
  );
  // Slice the inline script around its storage key rather than parsing HTML.
  const marker = html.indexOf('"nerve-light-theme"');
  assert.ok(marker >= 0);
  const open = "<script>";
  const start = html.lastIndexOf(open, marker) + open.length;
  const end = html.indexOf("</script>", marker);
  assert.ok(start >= open.length && end > start);
  const bootstrap = html.slice(start, end);

  function run(
    stored: Record<string, string>,
    systemDark: boolean,
  ): { theme?: string; dark?: boolean; themeColor?: string } {
    const result: { theme?: string; dark?: boolean; themeColor?: string } = {};
    const root = {
      dataset: {} as Record<string, string>,
      classList: {
        toggle: (name: string, active: boolean) => {
          assert.equal(name, "dark");
          result.dark = active;
        },
      },
    };
    runInNewContext(bootstrap, {
      document: {
        documentElement: root,
        querySelector: () => ({
          setAttribute: (_name: string, value: string) => {
            result.themeColor = value;
          },
        }),
      },
      window: {
        localStorage: { getItem: (key: string) => stored[key] ?? null },
        matchMedia: () => ({ matches: systemDark }),
      },
    });
    result.theme = root.dataset.theme;
    return result;
  }

  const both = {
    "nerve-light-theme": "nerve-light",
    "nerve-dark-theme": "graphite",
  };
  assert.equal(
    run({ ...both, "mode-watcher-mode": "dark" }, false).theme,
    "graphite",
  );
  assert.equal(
    run({ ...both, "mode-watcher-mode": "light" }, true).theme,
    "nerve-light",
  );
  assert.equal(
    run({ ...both, "mode-watcher-mode": "system" }, true).theme,
    "graphite",
  );
  assert.equal(run(both, false).theme, "nerve-light");
  assert.equal(
    run({ ...both, "mode-watcher-mode": "invalid" }, true).dark,
    true,
  );
  // Defaults and mismatched kinds.
  assert.equal(run({}, true).theme, "nerve-dark");
  assert.equal(
    run({ "nerve-dark-theme": "nerve-light" }, true).theme,
    "nerve-dark",
  );
  // Legacy single-theme ids map through the same table as the app.
  for (const [legacy, pair] of Object.entries(legacyColorThemes)) {
    const stored = { "nerve-color-theme": legacy };
    assert.equal(run(stored, false).theme, pair.light, `${legacy} light`);
    assert.equal(run(stored, true).theme, pair.dark, `${legacy} dark`);
  }

  let dark = false;
  runInNewContext(bootstrap, {
    document: {
      documentElement: {
        dataset: {},
        classList: {
          toggle: (_name: string, active: boolean) => {
            dark = active;
          },
        },
      },
      querySelector: () => null,
    },
    window: {
      localStorage: {
        getItem: () => {
          throw new Error("Denied");
        },
      },
      matchMedia: () => ({ matches: true }),
    },
  });
  assert.equal(dark, true);
});
