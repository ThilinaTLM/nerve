import { defineExtension, defineNamespace } from "@nervekit/extension-api";
import { diagramMethods, MAX_SOURCE_BYTES } from "./diagram-methods.js";

/** Diagrams rendered to PNG artifacts by a Kroki server. */
export const diagramExtension = defineExtension({
  id: "diagram",
  apiVersion: 1,
  name: "Diagrams",
  description: "Render Mermaid, D2, PlantUML and other diagrams with Kroki.",
  icon: "workflow",
  enabledByDefault: true,
  settings: {
    version: 1,
    fields: {
      server: {
        type: "string",
        label: "Kroki server",
        description:
          "Diagram source is sent to this server. The public default is shared.",
        format: "url",
        default: "https://kroki.io/",
        placeholder: "https://kroki.io/",
      },
    },
  },
  // The Kroki server the user configured; it may be on a private network.
  permissions: { network: ["{settings.server}"] },
  // Declared by the extension; the host fills `{{limit:diagram.source}}` in docs and rules.
  limits: { "diagram.source": MAX_SOURCE_BYTES },
  namespaces: [
    defineNamespace({
      id: "diagram",
      summary: "Kroki: mermaid, d2, plantuml… to PNG",
      methods: diagramMethods,
      types: "",
      docs: [
        {
          id: "diagram/render",
          whenToRead: "before rendering a diagram that goes on a page or slide",
          file: "docs/diagrams.md",
        },
      ],
    }),
  ],
});
