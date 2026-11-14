import { ATLASSIAN_SAMPLES } from "./atlassian-samples.js";

/** Representative arguments for every SDK method; a new method must be added here. */
export const SAMPLES: Record<string, unknown[][]> = {
  ...ATLASSIAN_SAMPLES,
  "imagegen.generate": [[{ prompt: "a red square" }]],
  "diagram.render": [[{ type: "mermaid", source: "graph TD; A-->B" }]],
  "files.list": [[]],
  "files.read": [["artifact:a.txt"], ["notes.txt"]],
  "files.write": [
    ["a.txt", { text: "x" }],
    ["a.txt", { text: "x" }, { workspace: true }],
  ],
  "files.edit": [
    ["artifact:a.txt", [{ oldText: "a", newText: "b" }]],
    ["notes.txt", [{ oldText: "a", newText: "b" }]],
  ],
  "image.info": [[{ file: "a.png", ops: {} }]],
  "image.save": [[{ file: "a.png", ops: {}, name: "b.png" }]],
  "web.fetch": [
    ["https://example.com/a"],
    [{ url: "https://example.com/a", as: "file", name: "a.bin" }],
  ],
  "web.search": [["nerve"], [{ query: "nerve", limit: 20 }]],
  "sdk.list": [[]],
  "sdk.describe": [["jira.issues"]],
  "sdk.search": [["sprint"], ["sprint", { in: "jira", offset: 0 }]],
  "sdk.docs": [[], ["jira"], ["jira/workflows"]],
};
