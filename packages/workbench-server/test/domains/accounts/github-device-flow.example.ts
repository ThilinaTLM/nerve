import type { AccountKindData } from "@nervekit/extension-api";

/**
 * Example: a GitHub account signed in with the device flow, as plain manifest data (an entry of
 * `defineExtension({ accounts: { ... } })`). No credential code: the host runs the standard OAuth 2.0
 * device authorization grant, stores the tokens, refreshes them when GitHub issues expiring ones,
 * and sends the access token as `Authorization: Bearer` to the origins below only. Nerve registers
 * no OAuth apps, so the user enters the client id of their own GitHub OAuth app (an author may
 * instead give the field a `default`).
 */
export const githubAccount = {
  label: "GitHub account",
  fields: {
    clientId: {
      type: "string",
      label: "OAuth app client id",
      description:
        "From GitHub → Settings → Developer settings → OAuth apps; enable the device flow.",
    },
  },
  provider: {
    type: "oauth2",
    flows: ["device_code"],
    deviceAuthorizationUrl: "https://github.com/login/device/code",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:user"],
    userinfo: {
      url: "https://api.github.com/user",
      identity: { login: "login", id: "id" },
    },
  },
  origins: ["https://api.github.com"],
} satisfies AccountKindData;
