import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLoginShellPath } from "../src/daemon/login-shell-path.js";

const START = "__NERVE_PATH_START_7f3a9c__";
const END = "__NERVE_PATH_END_7f3a9c__";

test("merges login PATH first, deduplicated, ignoring rc noise", async () => {
  let call: { shell: string; args: string[] } | undefined;
  const result = await resolveLoginShellPath(
    { SHELL: "/bin/fish", PATH: "/usr/bin:/bin" },
    {
      platform: "darwin",
      run: async (shell, args) => {
        call = { shell, args };
        return `noise\n${START}/opt/homebrew/bin:/usr/bin${END}\ntrailer`;
      },
    },
  );
  assert.equal(result, "/opt/homebrew/bin:/usr/bin:/bin");
  assert.equal(call?.shell, "/bin/fish");
  assert.equal(call?.args[0], "-ilc");
});

test("defaults the shell to zsh", async () => {
  let shell = "";
  await resolveLoginShellPath(
    { PATH: "/bin" },
    {
      platform: "darwin",
      run: async (s) => {
        shell = s;
        return `${START}/x${END}`;
      },
    },
  );
  assert.equal(shell, "/bin/zsh");
});

test("returns undefined on failure, missing markers, or non-darwin", async () => {
  const env = { PATH: "/bin" };
  assert.equal(
    await resolveLoginShellPath(env, {
      platform: "darwin",
      run: async () => {
        throw new Error("timeout");
      },
    }),
    undefined,
  );
  assert.equal(
    await resolveLoginShellPath(env, {
      platform: "darwin",
      run: async () => "no markers",
    }),
    undefined,
  );
  let ran = false;
  assert.equal(
    await resolveLoginShellPath(env, {
      platform: "linux",
      run: async () => {
        ran = true;
        return `${START}/x${END}`;
      },
    }),
    undefined,
  );
  assert.equal(ran, false);
});
