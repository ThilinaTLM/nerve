import assert from "node:assert/strict";
import { test } from "node:test";
import { describeField, fieldMetaMap, toApiFields } from "./field-values.js";
import type { JiraSession } from "./session.js";

const meta = fieldMetaMap({
  resolution: {
    name: "Resolution",
    schema: { type: "resolution" },
    allowedValues: [
      { id: "10000", name: "Done" },
      { id: "10001", name: "Done" },
      { id: "10002", name: "Won't Do" },
    ],
  },
});
const session = { fields: async () => [] } as unknown as JiraSession;
const convert = (value: string) =>
  toApiFields({ Resolution: value }, session, meta, {});

void test("duplicate option names list once with ids and resolve by id", async () => {
  assert.equal(
    describeField(meta.get("resolution")!),
    "Resolution (values: Done (id 10000), Done (id 10001), Won't Do)",
  );
  assert.deepEqual(await convert("10001"), { resolution: { id: "10001" } });
  assert.deepEqual(await convert("won't do"), {
    resolution: { name: "Won't Do" },
  });
  await assert.rejects(
    convert("Done"),
    /matches several values for Resolution: Done \(id 10000\), Done \(id 10001\)\. Pass one id\./,
  );
  assert.deepEqual(meta.get("resolution")!.allowed, ["Done", "Won't Do"]);
});
