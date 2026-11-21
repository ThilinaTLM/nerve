import {
  defineExtension,
  defineNamespace,
  ExtensionError,
  method,
} from "@nervekit/extension-sdk";

const get = method({
  risk: "external_read",
  signature:
    "/** GET a path of the GitHub API as the installation and return the JSON. */ get(path: string): Promise<unknown>",
  parse: (args) => {
    const path = args[0];
    if (typeof path !== "string" || !path.startsWith("/"))
      throw new ExtensionError(
        "BAD_REQUEST",
        "get needs a path that starts with '/'.",
      );
    return { path };
  },
  run: async (_session, { path }, ctx) =>
    (
      await ctx.http.request({
        url: `https://api.github.com${path}`,
        auth: { account: "account" },
        headers: { accept: "application/vnd.github+json" },
      })
    ).body,
});

export default defineExtension({
  id: "github-app",
  name: "GitHub App",
  description:
    "Reads GitHub as an app installation; tokens are minted in a credential provider.",
  icon: "globe",
  enabledByDefault: false,
  settings: {
    version: 1,
    fields: {
      account: {
        type: "account",
        kind: "github-app-installation",
        label: "GitHub App installation",
      },
    },
  },
  accounts: {
    "github-app-installation": {
      label: "GitHub App installation",
      fields: {
        appId: { type: "string", label: "App id" },
        installationId: { type: "string", label: "Installation id" },
      },
      secrets: {
        privateKey: {
          label: "Private key (PEM)",
          help: "From the app's settings page on GitHub.",
          multiline: true,
        },
      },
      provider: "extension",
      signInOrigins: ["https://api.github.com"],
      origins: ["https://api.github.com"],
    },
  },
  namespaces: [
    defineNamespace({
      id: "githubApp",
      summary: "Reads the GitHub API as an app installation.",
      types: "",
      methods: { get },
    }),
  ],
});
