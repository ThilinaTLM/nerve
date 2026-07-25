import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { protocolV1MessageSchema } from "../src/index.js";

interface FixtureCorpus {
  generatedBy: string;
  protocolVersion: number;
  validMessages: unknown[];
  invalidMessages: Array<{ name: string; input: unknown }>;
}

async function corpus(): Promise<FixtureCorpus> {
  const path = fileURLToPath(
    new URL("../schemas/native-spike-v1.fixtures.json", import.meta.url),
  );
  return JSON.parse(await readFile(path, "utf8")) as FixtureCorpus;
}

describe("native spike protocol fixtures", () => {
  it("keeps every valid wire message conformant with Protocol v1", async () => {
    const fixtures = await corpus();
    assert.equal(fixtures.protocolVersion, 1);
    assert.match(fixtures.generatedBy, /generate-native-spike-fixtures/);
    for (const message of fixtures.validMessages) {
      assert.doesNotThrow(() => protocolV1MessageSchema.parse(message));
    }
  });

  it("keeps intentional invalid cases invalid", async () => {
    const fixtures = await corpus();
    for (const fixture of fixtures.invalidMessages) {
      assert.throws(
        () => protocolV1MessageSchema.parse(fixture.input),
        undefined,
        fixture.name,
      );
    }
  });

  it("contains no credential-shaped fixture fields", async () => {
    const serialized = JSON.stringify(await corpus());
    assert.doesNotMatch(
      serialized,
      /"(?:authorization|cookie|credential|password|secret|token|apiKey|privateKey)"\s*:/i,
    );
  });
});
