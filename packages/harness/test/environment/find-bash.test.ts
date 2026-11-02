import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findBashOnPath } from "../../src/environment/node-environment.js";

describe("findBashOnPath", () => {
  it("skips the WSL launcher on Windows", async () => {
    const found = await findBashOnPath({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      pathExists: async () => true,
      runCommand: async () => ({
        stdout:
          "C:\\Windows\\System32\\bash.exe\r\nC:\\Tools\\Git\\bin\\bash.exe\r\n",
        status: 0,
      }),
    });
    assert.equal(found, "C:\\Tools\\Git\\bin\\bash.exe");
  });

  it("skips /bin/bash on macOS", async () => {
    const found = await findBashOnPath({
      platform: "darwin",
      env: {},
      pathExists: async () => true,
      runCommand: async () => ({
        stdout: "/bin/bash\n/opt/homebrew/bin/bash\n",
        status: 0,
      }),
    });
    assert.equal(found, "/opt/homebrew/bin/bash");
  });
});
