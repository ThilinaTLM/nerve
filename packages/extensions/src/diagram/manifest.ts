import { readExtensionDoc } from "../docs-source.js";
import type { ExtensionManifest } from "@nervekit/tools/quick-script/manifest-types";
import { diagramMethods, MAX_SOURCE_BYTES } from "./diagram-methods.js";

/** Diagrams rendered to PNG artifacts by a Kroki server. */
export const diagramExtension: ExtensionManifest = {
  id: "diagram",
  name: "Diagrams",
  description: "Render Mermaid, D2, PlantUML and other diagrams with Kroki.",
  source: "builtin",
  icon: "workflow",
  enabledByDefault: true,
  settingsVersion: 1,
  settings: {
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
  readDoc: (file) => readExtensionDoc("diagram", file),
  limits: { "diagram.source": MAX_SOURCE_BYTES },
  contributes: {
    sdk: [
      {
        id: "diagram",
        summary: "Kroki: mermaid, d2, plantuml… to PNG",
        methods: diagramMethods,
        types: "",
        docs: [
          {
            id: "diagram/render",
            whenToRead:
              "before rendering a diagram that goes on a page or slide",
            file: "diagrams.md",
          },
        ],
      },
    ],
  },
};
