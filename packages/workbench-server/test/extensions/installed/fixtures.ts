import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type FixtureOptions = {
  id: string;
  /** Global name of the namespace (default `probe`). */
  namespace?: string;
  /** Prefix of the two direct tools: `<prefix>_echo` (bound to the method) and `<prefix>_ping` (own implementation). */
  toolPrefix?: string;
  /** An account kind with a `test` hook. */
  accountKind?: string;
  sdkVersion?: string;
  /** Theme files (`night.json`); each is a valid dark theme unless `badThemes` names it. */
  themes?: string[];
  /** Themes (by file name in `themes`) whose tokens break a readability rule. */
  lowContrastThemes?: string[];
  /**
   * UI contributions (frames under `dist/ui/<id>/`) and two extra backend methods in the probe
   * namespace: `greet({ name })` and `peek(path)`, which declares a read of `path`.
   */
  ui?: {
    previews?: {
      id: string;
      extensions: string[];
      edit: "source" | "custom" | "none";
    }[];
    pages?: string[];
    panels?: string[];
  };
};

export const nerveDarkTokens = {
  background: "oklch(0.264 0.018 80)",
  foreground: "oklch(0.9 0.012 95)",
  primary: "oklch(0.6724 0.1308 38.8)",
  success: "oklch(0.78 0.176 149.2)",
  warning: "oklch(0.828 0.16 70.1)",
  info: "oklch(0.8 0.134 254.1)",
  destructive: "oklch(0.8 0.114 25.5)",
  "destructive-solid": "oklch(0.58 0.21 27.5)",
  "syntax-variable": "oklch(0.88 0.015 95)",
  "syntax-punctuation": "oklch(0.7 0.02 95)",
  "syntax-comment": "oklch(0.66 0.03 110)",
  "syntax-keyword": "oklch(0.76 0.13 32)",
  "syntax-string": "oklch(0.78 0.13 150)",
  "syntax-number": "oklch(0.79 0.12 315)",
  "syntax-function": "oklch(0.78 0.12 265)",
  "syntax-type": "oklch(0.8 0.09 210)",
  "syntax-property": "oklch(0.82 0.11 85)",
};

type Json = Record<string, unknown>;

/** `dist/manifest.json` of the probe extension, written by hand: the plain data of the definition in `backend`, hooks as `true`. */
export function fixtureManifest(options: FixtureOptions): Json {
  const namespace = options.namespace ?? "probe";
  const prefix = options.toolPrefix ?? "probe";
  return {
    id: options.id,
    apiVersion: 1,
    name: `Probe ${options.id}`,
    description: "A probe extension.",
    icon: "blocks",
    enabledByDefault: true,
    settings: {
      version: 1,
      fields: {
        greeting: { type: "string", label: "Greeting", default: "hi" },
      },
    },
    ...(options.accountKind
      ? {
          accounts: {
            [options.accountKind]: {
              label: "Probe account",
              fields: { site: { type: "string", label: "Site" } },
              secret: { label: "Token" },
              test: true,
            },
          },
        }
      : {}),
    namespaces: [
      {
        id: namespace,
        summary: "Probe namespace: echo(text).",
        types: "",
        availability: true,
        methods: {
          echo: {
            risk: "external_read",
            signature: "echo(text: string)",
            parse: true,
            authorize: true,
            run: true,
          },
          ...(options.ui
            ? {
                greet: {
                  risk: "none",
                  signature: "greet(input: { name: string })",
                  parse: true,
                  authorize: true,
                  run: true,
                },
                peek: {
                  risk: "read",
                  signature: "peek(path: string)",
                  parse: true,
                  authorize: true,
                  run: true,
                },
              }
            : {}),
        },
      },
    ],
    tools: [
      {
        name: `${prefix}_echo`,
        description: "Echo text through the probe namespace.",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
        method: `${namespace}.echo`,
      },
      {
        name: `${prefix}_ping`,
        description: "Ping the probe.",
        parameters: {
          type: "object",
          properties: { n: { type: "number" } },
          additionalProperties: false,
        },
        risk: "none",
        parse: true,
        run: true,
        present: true,
      },
    ],
    version: "1.0.0",
    sdkVersion: options.sdkVersion ?? "0.41.1",
    ...(options.themes || options.ui
      ? {
          ui: {
            ...(options.ui?.previews
              ? {
                  previews: options.ui.previews.map((preview) => ({
                    id: preview.id,
                    label: preview.id,
                    match: { extensions: preview.extensions },
                    edit: preview.edit,
                    entry: `ui/${preview.id}/index.html`,
                  })),
                }
              : {}),
            ...(options.ui?.pages
              ? {
                  pages: options.ui.pages.map((id) => ({
                    id,
                    label: id,
                    icon: "table",
                    entry: `ui/${id}/index.html`,
                  })),
                }
              : {}),
            ...(options.ui?.panels
              ? {
                  panels: options.ui.panels.map((id) => ({
                    id,
                    label: id,
                    icon: "table",
                    entry: `ui/${id}/index.html`,
                  })),
                }
              : {}),
            ...(options.themes
              ? {
                  themes: options.themes.map((file) => {
                    const id = file.replace(/\.json$/, "");
                    return {
                      id,
                      label: id,
                      kind: "dark",
                      file: `themes/${id}.json`,
                    };
                  }),
                }
              : {}),
          },
        }
      : {}),
  };
}

/** `dist/backend.js`: the same definition with its hooks, as an IIFE-style classic script over the runtime's API. */
export function fixtureBackend(options: FixtureOptions): string {
  const namespace = options.namespace ?? "probe";
  const prefix = options.toolPrefix ?? "probe";
  return String.raw`
const { defineExtension, defineNamespace, defineTool, method, ExtensionError } = globalThis.__nerveExtensionApi;
globalThis.__nerveExtension = defineExtension({
  id: ${JSON.stringify(options.id)},
  apiVersion: 1,
  name: ${JSON.stringify(`Probe ${options.id}`)},
  description: "A probe extension.",
  icon: "blocks",
  enabledByDefault: true,
  settings: { version: 1, fields: { greeting: { type: "string", label: "Greeting", default: "hi" } } },
  ${
    options.accountKind
      ? `accounts: { ${JSON.stringify(options.accountKind)}: {
    label: "Probe account",
    fields: { site: { type: "string", label: "Site" } },
    secret: { label: "Token" },
    test: async (account) =>
      account.fields.site === "bad"
        ? { ok: false, message: "Site rejected.", reason: "restricted" }
        : { ok: true, message: "hello " + account.name + " at " + account.fields.site },
  } },`
      : ""
  }
  namespaces: [defineNamespace({
    id: ${JSON.stringify(namespace)},
    summary: "Probe namespace: echo(text).",
    types: "",
    availability: (ctx) =>
      ctx.settings.get("greeting") === "broken"
        ? { available: false, reason: "The probe is broken.", fix: "Ask the user to change the greeting." }
        : { available: true },
    methods: {
      echo: method({
        risk: "external_read",
        signature: "echo(text: string)",
        // A script passes the text; a direct tool bound to the method passes its arguments object.
        parse: (args) => {
          const text = typeof args[0] === "string" ? args[0] : args[0] && args[0].text;
          if (typeof text !== "string")
            throw new ExtensionError("BAD_REQUEST", "echo needs a string.", { fix: "Pass a string." });
          return { text };
        },
        authorize: ({ text }) => [{ targets: ["probe:text/" + text], summary: "echo " + text }],
        run: async (_session, { text }, ctx) => ({ greeting: ctx.settings.get("greeting"), text }),
      }),${
        options.ui
          ? `
      greet: method({
        risk: "none",
        signature: "greet(input: { name: string })",
        parse: (args) => {
          if (!args[0] || typeof args[0].name !== "string")
            throw new ExtensionError("BAD_REQUEST", "greet needs a name.", { fix: "Pass { name }." });
          return { name: args[0].name };
        },
        authorize: () => [],
        run: async (_session, { name }, ctx) => ({ message: ctx.settings.get("greeting") + " " + name }),
      }),
      peek: method({
        risk: "read",
        signature: "peek(path: string)",
        parse: (args) => ({ path: String(args[0]) }),
        authorize: ({ path }) => [{ toolName: "read", args: { path }, summary: "read " + path }],
        run: async (_session, { path }) => ({ path }),
      }),`
          : ""
      }
    },
  })],
  tools: [
    defineTool({
      name: ${JSON.stringify(`${prefix}_echo`)},
      description: "Echo text through the probe namespace.",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
      method: ${JSON.stringify(`${namespace}.echo`)},
    }),
    defineTool({
      name: ${JSON.stringify(`${prefix}_ping`)},
      description: "Ping the probe.",
      parameters: { type: "object", properties: { n: { type: "number" } }, additionalProperties: false },
      risk: "none",
      parse: (args) => ({ n: typeof args.n === "number" ? args.n : 1 }),
      run: async (input) => ({ pong: input.n }),
      present: (output) => ({ text: "pong " + output.pong }),
    }),
  ],
});
`;
}

/** Writes `<root>/<folder>/dist/{manifest.json,backend.js}`; `edit` changes the manifest before it is written. */
export async function writeExtension(
  root: string,
  options: FixtureOptions & { folder?: string },
  edit?: (manifest: Json) => void,
  backend: string = fixtureBackend(options),
): Promise<string> {
  const folder = join(root, options.folder ?? options.id);
  const manifest = fixtureManifest(options);
  edit?.(manifest);
  await mkdir(join(folder, "dist"), { recursive: true });
  await writeFile(
    join(folder, "dist", "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  await writeFile(join(folder, "dist", "backend.js"), backend);
  for (const file of options.themes ?? []) {
    const id = file.replace(/\.json$/, "");
    await mkdir(join(folder, "dist", "themes"), { recursive: true });
    const tokens: Record<string, string> = { ...nerveDarkTokens };
    // Foreground and background of the same lightness cannot be read.
    if (options.lowContrastThemes?.includes(file))
      tokens.foreground = tokens.background!;
    await writeFile(
      join(folder, "dist", "themes", file),
      JSON.stringify({ id, label: id, kind: "dark", tokens }),
    );
  }
  const frames = [
    ...(options.ui?.previews ?? []).map((preview) => preview.id),
    ...(options.ui?.pages ?? []),
    ...(options.ui?.panels ?? []),
  ];
  for (const id of frames) {
    await mkdir(join(folder, "dist", "ui", id), { recursive: true });
    await writeFile(
      join(folder, "dist", "ui", id, "index.html"),
      `<!doctype html><script type="module" src="./app.js"></script><div id="${id}"></div>`,
    );
    await writeFile(
      join(folder, "dist", "ui", id, "app.js"),
      `export const id = ${JSON.stringify(id)};`,
    );
  }
  return folder;
}
