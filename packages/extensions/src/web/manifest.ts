import {
  defineExtension,
  defineNamespace,
  defineTool,
} from "@nervekit/extension-api";
import { WEB_DTS_TYPES } from "./declarations.js";
import { MAX_FETCH_BYTES, webMethods, webSearchTool } from "./web-methods.js";

/** `web.fetch` needs only the switch; `web.search` also needs a Tavily account. */
export const webExtension = defineExtension({
  id: "web",
  apiVersion: 1,
  name: "Web",
  description: "Fetch web pages and search the web.",
  icon: "globe",
  enabledByDefault: false,
  accounts: {
    tavily: {
      label: "Tavily account",
      fields: { name: { type: "string", label: "Name", maxLength: 128 } },
      secret: {
        label: "API key",
        help: "Get a Tavily API key at https://app.tavily.com.",
      },
      auth: { scheme: "bearer" },
      origins: ["https://api.tavily.com"],
    },
  },
  settings: {
    version: 1,
    fields: {
      searchAccount: {
        type: "account",
        kind: "tavily",
        label: "Search account",
        description: "The Tavily account `web.search` and web_search use.",
      },
    },
  },
  // `*`: `web.fetch` reaches any public http(s) origin; the host's SSRF guard still applies.
  permissions: { network: ["https://api.tavily.com", "*"] },
  limits: { "web.fetch": MAX_FETCH_BYTES },
  namespaces: [
    defineNamespace({
      id: "web",
      summary: "fetch, search",
      rules: [
        "`web.fetch` content can be up to {{limit:web.fetch}}: slice before printing. `web.search` needs a Tavily account, else `DENIED`.",
      ],
      methods: webMethods,
      types: WEB_DTS_TYPES,
    }),
  ],
  tools: [
    defineTool({
      name: "web_search",
      label: "Web Search",
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
      risk: "network",
      ...webSearchTool,
      display: "links",
      requires: { account: "searchAccount" },
    }),
  ],
});
