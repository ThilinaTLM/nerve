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
  themes?: string[];
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
    ...(options.themes
      ? {
          ui: {
            themes: options.themes.map((file) => {
              const id = file.replace(/\.json$/, "");
              return {
                id,
                label: id,
                kind: "dark",
                file: `themes/${id}.json`,
              };
            }),
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
      }),
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
  return folder;
}
