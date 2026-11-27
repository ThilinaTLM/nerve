import assert from "node:assert/strict";
import { test } from "node:test";
import { configurationResourceSchema } from "@nervekit/contracts/configuration";
import { extensionStateSchema } from "@nervekit/contracts/extensions";
import { layerSchema, sourceSchema } from "@nervekit/contracts/core";
import {
  mcpServerStateSchema,
  mcpTransportSchema,
} from "@nervekit/contracts/mcp";
import { CONFIGURATION_DTS_TYPES } from "./configuration/dts-types.js";
import { EXTENSIONS_DTS_TYPES } from "./extensions/dts-types.js";
import { MCP_DTS_TYPES } from "./mcp/dts-types.js";

/** The string-literal union written after `field:` / `field?:` in a model-facing `.d.ts` string. */
function declared(dts: string, field: string): string[] {
  const line = dts
    .split("\n")
    .find((entry) => new RegExp(`^\\s*${field}\\??: "`).test(entry));
  assert.ok(line, `no "${field}" union in the declarations`);
  const union = line.slice(line.indexOf(":") + 1).replace(/;.*$/, "");
  return [...union.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
}

const same = (actual: string[], expected: readonly string[]): void =>
  assert.deepEqual([...actual].sort(), [...expected].sort());

void test("quick-script .d.ts enums match the contracts schemas", () => {
  const resource = configurationResourceSchema.shape;
  same(declared(CONFIGURATION_DTS_TYPES, "scope"), resource.scope.options);
  same(declared(CONFIGURATION_DTS_TYPES, "state"), resource.state.options);
  same(declared(CONFIGURATION_DTS_TYPES, "shadowedBy"), sourceSchema.options);
  same(declared(MCP_DTS_TYPES, "transport"), mcpTransportSchema.options);
  same(declared(MCP_DTS_TYPES, "scope"), layerSchema.options);
  same(declared(MCP_DTS_TYPES, "state"), mcpServerStateSchema.options);
  same(declared(EXTENSIONS_DTS_TYPES, "source"), sourceSchema.options);
  same(declared(EXTENSIONS_DTS_TYPES, "state"), [
    ...extensionStateSchema.options,
    "not_found",
  ]);
});
