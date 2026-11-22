import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountChoicesFor } from "./extensions-view";

describe("platform account fields", () => {
  const accounts = {
    "platform:github": [
      { id: "a", name: "Mine", kind: "gh-a", detail: "GitHub · me" },
      { id: "b", name: "Work", kind: "gh-b", detail: "Work GitHub" },
    ],
  };
  const field = { platform: "github" };

  it("lists every account of the platform, whichever definition holds it", () => {
    assert.deepEqual(
      accountChoicesFor(field, accounts).map((choice) => choice.id),
      ["a", "b"],
    );
  });

  it("lists only the definitions the extension may select, when they are known", () => {
    assert.deepEqual(
      accountChoicesFor(field, accounts, { "gh-b": "Work GitHub" }).map(
        (choice) => choice.id,
      ),
      ["b"],
    );
    assert.deepEqual(accountChoicesFor(field, accounts, {}), []);
  });
});
