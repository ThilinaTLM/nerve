import { defineNamespace } from "@nervekit/extension-sdk";
import { get } from "./get";

/** What scripts call in `quick_script` as `__NAMESPACE__.get("/items")`. */
export const namespace = defineNamespace({
  id: "__NAMESPACE__",
  label: "__TITLE__",
  summary: "__TITLE__: get(path) reads JSON from the configured server.",
  types: "",
  docs: [
    {
      id: "__ID__/usage",
      whenToRead: "before reading from the __TITLE__ server: paths and errors",
      file: "docs/usage.md",
    },
  ],
  methods: { get },
});
