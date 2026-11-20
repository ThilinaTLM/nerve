import { defineExtension, defineNamespace } from "@nervekit/extension-api";
import { diagramMethods, MAX_SOURCE_BYTES } from "./diagram-methods.js";

/** Diagrams rendered to PNG artifacts by a Kroki server. */
export const diagramExtension = defineExtension({
  id: "diagram",
  name: "Diagrams",
  description:
    "Render Mermaid, PlantUML, Graphviz and other PNG-capable diagrams with Kroki.",
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
      label: "Diagrams",
      summary: "Kroki: mermaid, plantuml, graphviz… to PNG",
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
