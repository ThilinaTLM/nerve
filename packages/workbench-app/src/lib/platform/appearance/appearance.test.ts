import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileModule } from "svelte/compiler";
import ts from "typescript";
import { migrateStoredTheme, themeBackgrounds } from "./theme-preference";

const reports: unknown[] = [];
(
  globalThis as { __windowAppearanceReports?: unknown[] }
).__windowAppearanceReports = reports;

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
      '"../desktop/desktop-bridge.svelte"',
      JSON.stringify(
        `data:text/javascript,export const reportDesktopWindowAppearance = (value) => globalThis.__windowAppearanceReports.push(value);`,
      ),
    )
    .replace(
      '"./theme-preference"',
      JSON.stringify(import.meta.resolve("./theme-preference.ts")),
    );
  return (await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  )) as typeof import("./appearance.svelte");
}

function fakeRoot() {
  const classes = new Set<string>();
  return {
    dataset: {} as Record<string, string>,
    style: {} as { colorScheme?: string },
    classes,
    classList: {
      toggle: (name: string, active: boolean) => {
        if (active) classes.add(name);
        else classes.delete(name);
      },
    },
  };
}

const legacyKeys = [
  "nerve-light-theme",
  "nerve-dark-theme",
  "nerve-color-theme",
  "mode-watcher-mode",
  "mode-watcher-theme",
];

test("the theme migrates once, applies its kind, persists, and syncs other tabs without writeback", async (t) => {
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
  const root = fakeRoot();
  const meta = { content: "" };
  let systemDark = false;
  const globals = {
    localStorage: storage,
    document: {
      documentElement: root,
      querySelector: () => ({
        setAttribute: (_name: string, value: string) => {
          meta.content = value;
        },
      }),
    },
    window: {
      localStorage: storage,
      matchMedia: () => ({ matches: systemDark }),
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

  // Migration persists the resolved theme and drops every old key.
  for (const key of legacyKeys) values.set(key, "x");
  values.set("nerve-light-theme", "melange-light");
  values.set("mode-watcher-mode", "system");
  systemDark = false;
  assert.equal(appearance.loadAppearancePreference(), "melange-light");
  assert.deepEqual([...values], [["nerve-theme", "melange-light"]]);
  // Once migrated, the new key alone decides.
  values.set("mode-watcher-mode", "dark");
  assert.equal(appearance.loadAppearancePreference(), "melange-light");
  assert.equal(values.get("mode-watcher-mode"), "dark", "no second migration");
  values.clear();
  assert.equal(appearance.loadAppearancePreference(), "nerve-dark");
  assert.equal(values.get("nerve-theme"), "nerve-dark");

  appearance.setTheme("nerve-light");
  assert.equal(appearance.appearanceState.theme, "nerve-light");
  assert.equal(values.get("nerve-theme"), "nerve-light");
  assert.equal(root.dataset.theme, "nerve-light");
  assert.equal(root.classes.has("dark"), false);
  assert.equal(root.style.colorScheme, "light");
  assert.equal(meta.content, themeBackgrounds["nerve-light"]);
  appearance.setTheme("graphite");
  assert.equal(root.classes.has("dark"), true);
  assert.equal(root.style.colorScheme, "dark");
  assert.equal(meta.content, themeBackgrounds.graphite);

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
  emit("nerve-theme", "melange-dark");
  assert.equal(appearance.appearanceState.theme, "melange-dark");
  assert.equal(root.dataset.theme, "melange-dark");
  assert.equal(writes, before, "storage events never write back");
  emit("unrelated", "nerve-light");
  assert.equal(root.dataset.theme, "melange-dark");
  emit("nerve-theme", "garbage");
  assert.equal(appearance.appearanceState.theme, "nerve-dark");
  emit("nerve-theme", "nerve-light");
  emit(null, null);
  assert.equal(appearance.appearanceState.theme, "nerve-dark", "cleared");
  dispose();
  emit("nerve-theme", "graphite");
  assert.equal(appearance.appearanceState.theme, "nerve-dark");
});

test("the pre-paint bootstrap mirrors migrateStoredTheme", async () => {
  const { runInNewContext } = await import("node:vm");
  const html = await readFile(
    new URL("../../../../index.html", import.meta.url),
    "utf8",
  );
  // Slice the inline script around its storage key rather than parsing HTML.
  const marker = html.indexOf('"nerve-theme"');
  assert.ok(marker >= 0);
  const open = "<script>";
  const start = html.lastIndexOf(open, marker) + open.length;
  const end = html.indexOf("</script>", marker);
  assert.ok(start >= open.length && end > start);
  const bootstrap = html.slice(start, end);

  function run(stored: Record<string, string>, systemDark: boolean) {
    const values = new Map(Object.entries(stored));
    const root = fakeRoot();
    let themeColor: string | undefined;
    runInNewContext(bootstrap, {
      document: {
        documentElement: root,
        querySelector: () => ({
          setAttribute: (_name: string, value: string) => {
            themeColor = value;
          },
        }),
      },
      window: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        },
        matchMedia: () => ({ matches: systemDark }),
      },
    });
    return { root, themeColor, values };
  }

  const both = {
    "nerve-light-theme": "melange-light",
    "nerve-dark-theme": "graphite",
  };
  const cases: Record<string, string>[] = [
    {},
    both,
    { ...both, "mode-watcher-mode": "light" },
    { ...both, "mode-watcher-mode": "dark" },
    { ...both, "mode-watcher-mode": "system" },
    { ...both, "mode-watcher-mode": "invalid" },
    { "mode-watcher-mode": "system" },
    { "mode-watcher-mode": "light" },
    { "nerve-dark-theme": "nerve-light", "mode-watcher-mode": "dark" },
    { "nerve-light-theme": "garbage", "nerve-color-theme": "garbage" },
    ...["nerve", "solar", "ocean", "constructor"].flatMap(
      (legacy): Record<string, string>[] => [
        { "nerve-color-theme": legacy },
        { "nerve-color-theme": legacy, "mode-watcher-mode": "dark" },
      ],
    ),
    { "nerve-theme": "melange-dark", "mode-watcher-mode": "light" },
    { "nerve-theme": "garbage" },
  ];
  for (const stored of cases) {
    for (const systemDark of [false, true]) {
      const label = `${JSON.stringify(stored)} systemDark=${systemDark}`;
      const expected = migrateStoredTheme(
        (key) => stored[key] ?? null,
        systemDark,
      );
      const { root, themeColor, values } = run(stored, systemDark);
      assert.equal(root.dataset.theme, expected, label);
      assert.equal(root.classes.has("dark"), !expected.endsWith("-light"));
      assert.equal(
        root.style.colorScheme,
        root.classes.has("dark") ? "dark" : "light",
      );
      assert.equal(themeColor, themeBackgrounds[expected], label);
      if (stored["nerve-theme"] === undefined) {
        assert.deepEqual([...values], [["nerve-theme", expected]], label);
      }
    }
  }

  // Storage that throws still paints the default theme.
  const root = fakeRoot();
  runInNewContext(bootstrap, {
    document: { documentElement: root, querySelector: () => null },
    window: {
      get localStorage() {
        throw new Error("Denied");
      },
      matchMedia: () => ({ matches: false }),
    },
  });
  assert.equal(root.dataset.theme, "nerve-dark");
  assert.equal(root.classes.has("dark"), true);
});

test("applying a theme reports its background and kind to the desktop shell", async () => {
  const appearance = await loadAppearance();
  reports.length = 0;
  appearance.applyAppearance("nerve-dark");
  appearance.applyAppearance("nerve-light");
  assert.deepEqual(reports, [
    { background: themeBackgrounds["nerve-dark"], dark: true },
    { background: themeBackgrounds["nerve-light"], dark: false },
  ]);
});
