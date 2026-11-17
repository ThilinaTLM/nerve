import { defineExtension } from "@nervekit/extension-sdk";

export default defineExtension({
  id: "csv-preview",
  apiVersion: 1,
  name: "CSV Preview",
  description: "Shows CSV and TSV files as a table.",
  icon: "table",
  enabledByDefault: true,
  settings: { version: 1, fields: {} },
  namespaces: [],
  // A preview that edits its own file: set `edit: "custom"` below, then use host.file.write(...)
  // and the `mode` store in the component. Without it, Nerve's source editor edits the file.
  ui: {
    previews: [
      {
        id: "table",
        label: "Table",
        match: { extensions: [".csv", ".tsv"] },
        entry: "src/ui/table.svelte",
      },
    ],
  },
});
