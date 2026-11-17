import type { ExtensionKind } from "./init.js";

/** The files of a new extension project, by relative path. */
export type Template = Record<string, string>;

/** `my-service` becomes `myService`: namespace ids are global names in the script sandbox. */
export function namespaceName(id: string): string {
  const camel = id.replace(/-([a-z0-9])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
  return camel.slice(0, 32);
}

function title(id: string): string {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const common = (id: string, sdkVersion: string): Template => ({
  "package.json": `${JSON.stringify(
    {
      name: id,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        build: "nerve-ext build",
        check: "nerve-ext check",
        test: "nerve-ext test",
        dev: "nerve-ext dev",
      },
      dependencies: { "@nervekit/extension-sdk": sdkVersion },
    },
    null,
    2,
  )}\n`,
  "tsconfig.json": `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM"],
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        isolatedModules: true,
        resolveJsonModule: true,
        types: [],
      },
      include: ["src", "test"],
    },
    null,
    2,
  )}\n`,
  ".gitignore": "node_modules/\n",
});

function integration(id: string): Template {
  const ns = namespaceName(id);
  const tool = `${id.replace(/-/g, "_")}_get`;
  const name = title(id);
  return {
    "src/extension.ts": `import {
  defineExtension,
  defineNamespace,
  ExtensionError,
  method,
} from "@nervekit/extension-sdk";

/** Reads JSON from the configured server. */
export const get = method({
  risk: "external_read",
  signature:
    "/** GET a path on the configured server and return the parsed JSON (or text). */ get(path: string): Promise<unknown>",
  // A script passes the path; a direct tool bound to this method passes its arguments object.
  parse: (args) => {
    const first = args[0];
    const path =
      typeof first === "string" ? first : (first as { path?: unknown } | undefined)?.path;
    if (typeof path !== "string" || !path.startsWith("/"))
      throw new ExtensionError("BAD_REQUEST", "get needs a path that starts with '/'.", {
        fix: 'Pass a path such as "/items".',
      });
    return { path };
  },
  authorize: ({ path }) => [{ targets: [\`${id}:\${path}\`], summary: \`GET \${path}\` }],
  run: async (_session, { path }, ctx) => {
    const server = String(ctx.settings.get("server") ?? "").replace(/\\/+$/, "");
    const response = await ctx.http.request({ url: \`\${server}\${path}\` });
    if (!response.ok)
      throw new ExtensionError("SERVER_ERROR", \`The server answered \${response.status}.\`, {
        fix: "Check the server setting and the path.",
      });
    return response.body;
  },
});

export default defineExtension({
  id: "${id}",
  apiVersion: 1,
  name: "${name}",
  description: "Reads data from a server the user configures.",
  icon: "globe",
  enabledByDefault: false,
  settings: {
    version: 1,
    fields: {
      server: {
        type: "string",
        label: "Server",
        description: "Base URL of the server; requests are sent to it.",
        format: "url",
        default: "https://example.com",
      },
    },
  },
  permissions: { network: ["{settings.server}"] },
  namespaces: [
    defineNamespace({
      id: "${ns}",
      label: "${name}",
      summary: "${name}: get(path) reads JSON from the configured server.",
      types: "",
      methods: { get },
    }),
  ],
  tools: [
    {
      name: "${tool}",
      description: "Read JSON from the configured ${name} server.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path starting with '/'." } },
        required: ["path"],
        additionalProperties: false,
      },
      method: "${ns}.get",
    },
  ],
});
`,
    "test/extension.test.ts": `import { createFakeContext, describe, expect, it } from "@nervekit/extension-sdk/testing";
import extension, { get } from "../src/extension";
import fixture from "../fixtures/items.json";

describe("${id}", () => {
  it("declares its id", () => {
    expect(extension.id).toBe("${id}");
  });

  it("reads JSON from the configured server", async () => {
    const { ctx, record } = createFakeContext({
      settings: { server: "https://api.test/" },
      http: () => ({ status: 200, ok: true, headers: {}, url: "", body: fixture }),
    });
    const input = get.parse(["/items"]);
    expect(await get.run(undefined, input, ctx)).toEqual(fixture);
    expect(record.requests[0]?.url).toBe("https://api.test/items");
  });

  it("rejects a path without a leading slash", () => {
    expect(() => get.parse(["items"])).toThrow("starts with '/'");
  });
});
`,
    "fixtures/items.json": `${JSON.stringify(
      [
        { id: 1, name: "first" },
        { id: 2, name: "second" },
      ],
      null,
      2,
    )}\n`,
  };
}

/** The backend of the kinds whose UI the SDK builds later: a settings-only extension that still builds, tests and loads. */
function minimal(
  id: string,
  kind: Exclude<ExtensionKind, "integration">,
): Template {
  const name = title(id);
  const noun = {
    preview: "file preview",
    page: "page",
    panel: "side panel",
    theme: "theme",
  }[kind];
  return {
    "src/extension.ts": `import { defineExtension } from "@nervekit/extension-sdk";

/**
 * A ${noun} extension. Its ${noun} contribution is declared in a later SDK version; until then
 * the extension carries only its identity and settings, which already build, test and load.
 */
export default defineExtension({
  id: "${id}",
  apiVersion: 1,
  name: "${name}",
  description: "A ${noun} for Nerve.",
  icon: "blocks",
  enabledByDefault: true,
  settings: { version: 1, fields: {} },
  namespaces: [],
});
`,
    "test/extension.test.ts": `import { describe, expect, it } from "@nervekit/extension-sdk/testing";
import extension from "../src/extension";

describe("${id}", () => {
  it("declares its id and no backend namespaces", () => {
    expect(extension.id).toBe("${id}");
    expect(extension.namespaces).toEqual([]);
  });
});
`,
    "fixtures/README.md": `Sample files for tests and \`nerve-ext dev\` go here.\n`,
  };
}

export function projectTemplate(
  id: string,
  kind: ExtensionKind,
  sdkVersion: string,
): Template {
  return {
    ...common(id, sdkVersion),
    ...(kind === "integration" ? integration(id) : minimal(id, kind)),
  };
}
