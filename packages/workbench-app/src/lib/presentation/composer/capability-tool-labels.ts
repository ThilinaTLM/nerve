import type { CapabilityToolName } from "@nervekit/contracts/capabilities";

/** Short labels for tools that projects and conversations can pin. */
export const capabilityToolLabels: Record<CapabilityToolName, string> = {
  explore: "Explore",
  subagents: "Async Subagents",

  web_search: "Web search",
  web_fetch: "Web fetch",
  explain_image: "Image explanation",
  generate_image: "Generate Image",
  python_exec: "Python",
  jira: "Jira",
  confluence: "Confluence",
};
