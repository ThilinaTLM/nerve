import {
  defineExtension,
  defineNamespace,
  defineTool,
  ExtensionError,
  method,
} from "@nervekit/extension-api";

/** What the demo namespace's session counted, to check sessions live once per run. */
export const demoSessions = { created: 0 };

type DemoSession = { id: number };

type Item = { id: string; name: string };

const text = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value)
    throw new Error(`${name} must be a non-empty string.`);
  return value;
};

/**
 * A small extension written only against `@nervekit/extension-api`, used to
 * prove the host end to end: settings, an account with injected bearer auth, an
 * artifact, report entries, a direct tool bound to a method and availability.
 */
export const demoExtension = defineExtension({
  id: "demo",
  apiVersion: 1,
  name: "Demo",
  description: "Test extension.",
  icon: "box",
  enabledByDefault: true,
  settings: {
    version: 1,
    fields: {
      account: { type: "account", kind: "demo", label: "Account" },
      items: { type: "boolean", label: "Items", default: true },
      prefix: { type: "string", label: "Prefix", default: "item" },
      maintenance: { type: "boolean", label: "Maintenance", default: false },
    },
  },
  accounts: {
    demo: {
      label: "Demo account",
      fields: { baseUrl: { type: "string", label: "Base URL", format: "url" } },
      secret: { label: "API token" },
      auth: { scheme: "bearer" },
      origins: ["{baseUrl}"],
    },
  },
  permissions: { network: ["{account.baseUrl}"] },
  namespaces: [
    defineNamespace<DemoSession>({
      id: "demo",
      enabledBy: "items",
      requires: { account: "account" },
      summary: "demo items",
      types: "interface Item { id: string; name: string }",
      session: () => ({ id: ++demoSessions.created }),
      availability: (ctx) =>
        ctx.settings.get<boolean>("maintenance")
          ? {
              available: false,
              reason: "the demo service is in maintenance.",
              fix: "Ask the user to switch off Maintenance in Settings → Extensions → Demo.",
            }
          : { available: true },
      methods: {
        "items.get": method({
          risk: "network",
          signature: "get(id: string): Promise<Item>",
          // A bound tool passes its arguments object; a script passes the id.
          parse: ([first]) =>
            text(
              typeof first === "object" && first !== null
                ? (first as { id?: unknown }).id
                : first,
              "id",
            ),
          authorize: (id) => ({
            targets: [`demo:item/${id}`],
            summary: id,
          }),
          run: async (_session, id, ctx) => {
            const response = await ctx.http.request({
              url: `${(await ctx.accounts.selected("account"))!.fields.baseUrl}/items/${id}`,
              auth: { account: "account" },
              response: "json",
            });
            if (response.status === 404)
              throw new ExtensionError("NOT_FOUND", `item ${id} not found`);
            return response.body as Item;
          },
        }),
        "items.create": method({
          risk: "external_write",
          signature: "create(name: string): Promise<Item>",
          parse: (args) => text(args[0], "name"),
          authorize: (name) => ({
            targets: ["demo:item/new"],
            summary: `create ${name}`,
          }),
          run: async (session, name, ctx) => {
            const response = await ctx.http.request({
              url: `${(await ctx.accounts.selected("account"))!.fields.baseUrl}/items`,
              method: "POST",
              body: {
                json: { name: `${ctx.settings.get<string>("prefix")}-${name}` },
              },
              auth: { account: "account" },
            });
            const item = response.body as Item;
            ctx.report.created(`item ${item.id}`);
            ctx.report.note(`session ${session.id}`);
            return item;
          },
        }),
        "items.export": method({
          risk: "network",
          signature: "export(id: string): Promise<string>",
          parse: (args) => text(args[0], "id"),
          authorize: (id) => ({ targets: [`demo:item/${id}`], summary: id }),
          run: async (_session, id, ctx) => {
            const response = await ctx.http.request({
              url: `${(await ctx.accounts.selected("account"))!.fields.baseUrl}/items/${id}/export`,
              auth: { account: "account" },
              response: { artifact: `item-${id}.txt` },
            });
            return (response.body as { handle: string }).handle;
          },
        }),
        probe: method({
          risk: "network",
          signature: "probe(url: string): Promise<number>",
          parse: (args) => text(args[0], "url"),
          authorize: (url) => ({ targets: [`demo:url/${url}`], summary: url }),
          run: async (_session, url, ctx) =>
            (await ctx.http.request({ url, auth: { account: "account" } }))
              .status,
        }),
        "files.size": method({
          risk: "read",
          signature: "size(handle: string): Promise<number>",
          parse: (args) => text(args[0], "handle"),
          authorize: (handle) =>
            handle.startsWith("artifact:")
              ? undefined
              : [
                  {
                    toolName: "read",
                    args: { path: handle },
                    summary: handle,
                  },
                ],
          run: async (_session, handle, ctx) =>
            (await ctx.artifacts.read(handle)).bytes.byteLength,
        }),
        "files.sneak": method({
          risk: "read",
          signature: "sneak(handle: string): Promise<number>",
          parse: (args) => text(args[0], "handle"),
          // Declares no read: the host must refuse the file.
          authorize: () => undefined,
          run: async (_session, handle, ctx) =>
            (await ctx.artifacts.read(handle)).bytes.byteLength,
        }),
      },
    }),
  ],
  tools: [
    defineTool({
      name: "demo_item",
      label: "Demo item",
      method: "demo.items.get",
      description: "Fetch one demo item by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      display: "markdown",
      enabledBy: "items",
      requires: { account: "account" },
    }),
  ],
});
