import {
  defineExtension,
  defineNamespace,
  defineTool,
} from "@nervekit/extension-api";
import { SEARCH_DTS_TYPES } from "./declarations.js";
import { providerAccounts, searchProviders } from "./providers/index.js";
import {
  SEARCH_ACCOUNT_FIELD,
  searchMethods,
  webSearchTool,
} from "./search-methods.js";

/** Web search through the provider of the selected account (`providers/`); `web.fetch` is built into quick_script. */
export const webSearchExtension = defineExtension({
  id: "web-search",
  name: "Web Search",
  description: "Search the web with your own search provider account.",
  icon: "icon.svg",
  enabledByDefault: false,
  accounts: providerAccounts,
  settings: {
    version: 1,
    fields: {
      [SEARCH_ACCOUNT_FIELD]: {
        type: "account",
        kind: searchProviders.map((provider) => provider.kind),
        label: "Search account",
        description: "The account web searches run with.",
      },
    },
  },
  permissions: {
    network: searchProviders.flatMap(
      (provider) => provider.account.origins ?? [],
    ),
  },
  namespaces: [
    defineNamespace({
      id: "search",
      label: "Search",
      summary: "web search",
      rules: ["`search.web` needs a search account, else `DENIED`."],
      methods: searchMethods,
      types: SEARCH_DTS_TYPES,
    }),
  ],
  tools: [
    defineTool({
      name: "web_search",
      label: "Web search",
      description: "Search the web.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          max_results: { type: "number", minimum: 1, maximum: 20, default: 5 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      risk: "external_read",
      ...webSearchTool,
      view: {
        header: { argument: "query" },
        meta: ["max_results"],
        sections: [{ id: "results", type: "links" }],
      },
      requires: { account: SEARCH_ACCOUNT_FIELD },
    }),
  ],
});
