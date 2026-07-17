import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CliContainerDriver } from "../src/drivers/cli-container-driver.js";

const ref = { kind: "docker" as const, id: "missing", name: "missing" };

function failingCommand(message: string): string[] {
  return [
    process.execPath,
    "-e",
    `console.error(${JSON.stringify(message)}); process.exit(1)`,
  ];
}

describe("CliContainerDriver.remove", () => {
  it("treats an already absent container as removed", async () => {
    const driver = new CliContainerDriver(
      "docker",
      failingCommand("Error response from daemon: No such container: missing"),
    );

    await assert.doesNotReject(driver.remove(ref, { removeVolumes: true }));
  });

  it("preserves other runtime removal failures", async () => {
    const driver = new CliContainerDriver(
      "docker",
      failingCommand("permission denied"),
    );

    await assert.rejects(driver.remove(ref), /permission denied/);
  });
});
