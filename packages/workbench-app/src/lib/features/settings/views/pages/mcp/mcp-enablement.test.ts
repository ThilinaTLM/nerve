import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mcpEnablementLayers } from "./mcp-enablement";

const layers = (input: Partial<Parameters<typeof mcpEnablementLayers>[0]>) =>
  mcpEnablementLayers({
    entry: {},
    user: {},
    name: "github",
    projectOwned: false,
    ...input,
  });

describe("mcpEnablementLayers", () => {
  it("is on unless the entry says otherwise", () => {
    assert.equal(layers({}).user, true);
    assert.equal(layers({ entry: { enabled: false } }).user, false);
  });

  it("lets a named choice beat the layer's defaults, and the project beat the user", () => {
    const result = layers({
      user: { mcpServers: { defaults: false, servers: { github: true } } },
      project: { mcpServers: { servers: { github: false } } },
    });
    assert.equal(result.user, true);
    assert.equal(result.project, false);
    assert.equal(result.value.project, false);
  });

  it("has no User choice for a project's own server, but inherits the user's decision", () => {
    const result = layers({
      projectOwned: true,
      user: { mcpServers: { defaults: false } },
    });
    assert.equal(result.value.user, undefined);
    assert.equal(result.value.builtinDefault, false);
    assert.equal(result.project, false);
  });
});
