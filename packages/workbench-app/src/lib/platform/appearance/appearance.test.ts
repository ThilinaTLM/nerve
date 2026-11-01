import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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
      /import \{ setMode, userPrefersMode \} from "mode-watcher";/,
      'const setMode = () => {}; const userPrefersMode = { current: "system" };',
    );
  return (await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  )) as typeof import("./appearance.svelte");
}

test("client theme persists, restores retired ids, and syncs other tabs without writeback", async (t) => {
  const values = new Map<string, string>();
  let writes = 0;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes++;
      values.set(key, value);
    },
  };
  const target = new EventTarget();
  const root = { dataset: {} as Record<string, string> };
  const globals = {
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
  for (const [stored, expected] of [
    ["ocean", "solar"],
    ["forest", "rose"],
    ["invalid", "nerve"],
    ["midnight", "midnight"],
  ]) {
    values.set("nerve-color-theme", stored);
    assert.equal(appearance.loadAppearancePreference().theme, expected);
  }
  appearance.setColorTheme("rose");
  assert.equal(appearance.appearanceState.theme, "rose");
  assert.equal(root.dataset.theme, "rose");
  assert.equal(values.get("nerve-color-theme"), "rose");
  const dispose = appearance.installAppearanceStorageSync();
  assert.equal(appearance.installAppearanceStorageSync(), dispose);
  t.after(dispose);
  const emit = (
    key: string | null,
    newValue: string | null,
    storageArea = storage,
  ) => {
    const event = Object.assign(new Event("storage"), {
      key,
      newValue,
      storageArea,
    });
    target.dispatchEvent(event);
  };
  const before = writes;
  emit("nerve-color-theme", "ocean");
  assert.equal(appearance.appearanceState.theme, "solar");
  assert.equal(root.dataset.theme, "solar");
  assert.equal(writes, before);
  emit("unrelated", "rose");
  assert.equal(appearance.appearanceState.theme, "solar");
  emit("nerve-color-theme", "invalid");
  assert.equal(appearance.appearanceState.theme, "nerve");
  emit("nerve-color-theme", "midnight");
  emit(null, null);
  assert.equal(appearance.appearanceState.theme, "nerve");
  dispose();
  emit("nerve-color-theme", "rose");
  assert.equal(appearance.appearanceState.theme, "nerve");
});

test("pre-paint bootstrap restores retired themes and stored or system mode", async () => {
  const { runInNewContext } = await import("node:vm");
  const html = await readFile(
    new URL("../../../../index.html", import.meta.url),
    "utf8",
  );
  const bootstrap = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((script) => script?.includes('getItem("nerve-color-theme")'));
  assert.ok(bootstrap);
  for (const [mode, systemDark, expectedDark] of [
    ["dark", false, true],
    ["light", true, false],
    ["system", true, true],
    [null, false, false],
    ["invalid", true, true],
  ] as const) {
    const root = {
      dataset: {} as Record<string, string>,
      classList: {
        toggle: (name: string, active: boolean) => {
          assert.equal(name, "dark");
          assert.equal(active, expectedDark);
        },
      },
    };
    runInNewContext(bootstrap, {
      document: { documentElement: root },
      window: {
        localStorage: {
          getItem: (key: string) =>
            key === "nerve-color-theme" ? "ocean" : mode,
        },
        matchMedia: () => ({ matches: systemDark }),
      },
    });
    assert.equal(root.dataset.theme, "solar");
  }
  let dark = false;
  runInNewContext(bootstrap, {
    document: {
      documentElement: {
        classList: {
          toggle: (_name: string, active: boolean) => {
            dark = active;
          },
        },
      },
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
