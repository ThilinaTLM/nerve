import { readExtensionDoc } from "../docs-source.js";
import type { ExtensionManifest } from "@nervekit/tools/quick-script/manifest-types";
import { WEB_DTS_TYPES } from "./declarations.js";
import { webMethods } from "./web-methods.js";

/** `web.fetch` needs only the switch; `web.search` also needs a Tavily account. */
export const webExtension: ExtensionManifest = {
  id: "web",
  name: "Web",
  description: "Fetch web pages and search the web.",
  source: "builtin",
  icon: "globe",
  enabledByDefault: false,
  settingsVersion: 1,
  accounts: [
    {
      kind: "tavily",
      label: "Tavily account",
      fields: { name: { type: "string", label: "Name", maxLength: 128 } },
      secret: { label: "API key" },
    },
  ],
  settings: {
    fields: {
      searchAccount: {
        type: "account",
        kind: "tavily",
        label: "Search account",
        description: "The Tavily account `web.search` and web_search use.",
      },
    },
  },
  readDoc: (file) => readExtensionDoc("web", file),
  contributes: {
    tools: ["web_fetch", "web_search"],
    sdk: [
      {
        id: "web",
        summary: "fetch, search",
        rules: [
          "`web.fetch` content can be up to {{limit:web.fetch}}: slice before printing. `web.search` needs a Tavily account, else `DENIED`.",
        ],
        methods: webMethods,
        types: WEB_DTS_TYPES,
        docs: [],
      },
    ],
  },
};
