import { Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

const webSearchParameters = Type.Object(
  {
    query: Type.String({ description: "The search query" }),
    max_results: Type.Optional(
      Type.Number({
        description: "Maximum number of results (default: 5)",
        minimum: 1,
        maximum: 20,
      }),
    ),
  },
  { additionalProperties: false },
);

const webFetchParameters = Type.Object(
  {
    url: Type.String({ description: "The URL to fetch" }),
    raw: Type.Optional(
      Type.Boolean({
        description:
          "If true, save raw content to a temp file and return the path (default: false)",
      }),
    ),
  },
  { additionalProperties: false },
);

export const webToolDefinitions = [
  {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web with Tavily; requires a configured API key in Nerve Settings.",
    promptSnippet: "Search the web for current external information",
    parameters: webSearchParameters,
    executionMode: "parallel",
  },
  {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL. HTML converts to markdown unless raw=true; large or binary responses are saved.",
    promptSnippet: "Fetch URL contents; HTML is converted to markdown",
    parameters: webFetchParameters,
    executionMode: "parallel",
  },
] satisfies CoreToolDefinition[];
