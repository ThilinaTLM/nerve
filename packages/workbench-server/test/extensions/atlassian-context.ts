import type { AccountInfo } from "@nervekit/extension-api";
import type { ExtensionHostPorts } from "@nervekit/tools/quick-script";

export const SITE = "https://example.atlassian.net";

/**
 * The host ports of a conversation with an Atlassian account selected: what the
 * server's settings resolution and accounts store provide. `account: false`
 * leaves it unselected; `products` are the `jira` / `confluence` switches.
 */
export function atlassianPorts(
  options: {
    account?: false;
    fields?: Record<string, unknown>;
    products?: { jira?: boolean; confluence?: boolean };
  } = {},
): ExtensionHostPorts {
  const account: AccountInfo = {
    id: "acct",
    name: "Acme",
    kind: "atlassian",
    fields: { siteUrl: SITE, email: "dev@example.com", ...options.fields },
  };
  return {
    settings: (id) =>
      id === "atlassian"
        ? {
            ...(options.account === false ? {} : { account: account.id }),
            jira: options.products?.jira ?? true,
            confluence: options.products?.confluence ?? true,
          }
        : {},
    accounts: {
      get: async (kind, id) =>
        kind === "atlassian" && id === account.id ? account : undefined,
      secret: async () => "token",
    },
  };
}

/** The fetch policy tests use: requests go to the mocked `fetch`, with no DNS lookup. */
export const mockedNetwork = { allowPrivateNetwork: true };
