import assert from "node:assert/strict";
import { it } from "node:test";
import { subagentPresentation } from "./subagent-presentation";

it("puts a single subagent's status facts in footer chips without repeating its name", () => {
  const model = subagentPresentation(
    {
      kind: "subagent",
      action: "status",
      name: "stream-backend",
      rows: [],
      header:
        "stream-backend · explore · gpt-5 · running · ctx 34k/100k · run 20s",
      body: "Investigating streams",
    },
    {
      badge: "subagent_status",
      meta: [],
      dotTone: "success",
      dotPulse: false,
    },
  );
  assert.deepEqual(model.primaryArg, { text: "stream-backend" });
  assert.deepEqual(model.meta, [
    { text: "explore" },
    { text: "gpt-5" },
    { text: "running" },
    { text: "ctx 34k/100k" },
    { text: "run 20s" },
  ]);
});
