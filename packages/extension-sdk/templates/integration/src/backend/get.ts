import { ExtensionError, method } from "@nervekit/extension-sdk";

/** Reads JSON from the configured server. */
export const get = method({
  risk: "external_read",
  signature:
    "/** GET a path on the configured server and return the parsed JSON (or text). */ get(path: string): Promise<unknown>",
  // A script passes the path; a direct tool bound to this method passes its arguments object.
  parse: (args) => {
    const first = args[0];
    const path =
      typeof first === "string"
        ? first
        : (first as { path?: unknown } | undefined)?.path;
    if (typeof path !== "string" || !path.startsWith("/"))
      throw new ExtensionError(
        "BAD_REQUEST",
        "get needs a path that starts with '/'.",
        { fix: 'Pass a path such as "/items".' },
      );
    return { path };
  },
  authorize: ({ path }) => [
    { targets: [`__ID__:path${path}`], summary: `GET ${path}` },
  ],
  run: async (_session, { path }, ctx) => {
    const server = String(ctx.settings.get("server") ?? "").replace(/\/+$/, "");
    const response = await ctx.http.request({ url: `${server}${path}` });
    if (!response.ok)
      throw new ExtensionError(
        "SERVER_ERROR",
        `The server answered ${response.status}.`,
        { fix: "Check the server setting and the path." },
      );
    return response.body;
  },
});
