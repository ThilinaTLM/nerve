import { Type } from "typebox";
import { executeWebFetch } from "../../../execution/web/web-fetch.js";
import { executeWebSearch } from "../../../execution/web/web-search.js";
import type { ToolDefinition } from "../../contracts.js";

const webSearchParameters = Type.Object(
  {
    query: Type.String(),
    max_results: Type.Optional(
      Type.Number({
        minimum: 1,
        maximum: 20,
      }),
    ),
  },
  { additionalProperties: false },
);

const webFetchParameters = Type.Object(
  {
    url: Type.String(),
    raw: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const webToolDefinitions = [
  {
    name: "web_search",
    group: "web",
    baseRisk: "network",
    traits: ["credentialed"],
    executionKind: "local",
    executor: executeWebSearch,
    label: "Web Search",
    description: "Search the web.",
    parameters: webSearchParameters,
    executionMode: "parallel",
  },
  {
    name: "web_fetch",
    group: "web",
    baseRisk: "network",
    permission: {
      durableAllow: "target",
      targets: [{ kind: "web_host", argument: "url" }],
    },
    traits: [],
    executionKind: "local",
    executor: executeWebFetch,
    label: "Web Fetch",
    description:
      "Fetch a URL. HTML is converted to Markdown unless `raw`; large or binary responses are saved to files.",
    parameters: webFetchParameters,
    executionMode: "parallel",
  },
] satisfies ToolDefinition[];
