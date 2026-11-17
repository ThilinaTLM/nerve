import { defineExtension } from "@nervekit/extension-sdk";

export default defineExtension({
  id: "paper-theme",
  apiVersion: 1,
  name: "Paper Theme",
  description: "A colour theme.",
  icon: "palette",
  enabledByDefault: true,
  settings: { version: 1, fields: {} },
  namespaces: [],
  ui: {
    themes: [
      {
        id: "paper-theme",
        label: "Paper Theme",
        file: "themes/paper-theme.json",
      },
    ],
  },
});
