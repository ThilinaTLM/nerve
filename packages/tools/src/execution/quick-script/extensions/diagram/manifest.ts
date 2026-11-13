import type { ExtensionManifest } from "../manifest-types.js";
import { diagramMethods } from "./diagram-methods.js";

/** Diagrams rendered to PNG artifacts by a Kroki server. */
export const diagramExtension: ExtensionManifest = {
  id: "diagram",
  name: "Diagrams",
  description: "Render Mermaid, D2, PlantUML and other diagrams with Kroki.",
  source: "builtin",
  icon: "workflow",
  contributes: {
    tools: ["kroki_export"],
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
