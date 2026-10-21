import assert from "node:assert/strict";
import { it } from "node:test";
import { ProfileSettingsSession } from "./agent-profile-session";

it("captures the write target even when both documents are missing", () => {
  const session = new ProfileSettingsSession();
  const editor = session.capture(
    { scope: "project", projectId: "proj_a" },
    null,
  );
  session.navigate({ scope: "project", projectId: "proj_b" });
  assert.deepEqual(editor.target, { scope: "project", projectId: "proj_a" });
  assert.equal(editor.digest, null);
  assert.equal(session.isCurrent(editor), false);
});

it("rejects stale success/error completions after navigating away and back", () => {
  const session = new ProfileSettingsSession();
  const pending = session.capture({ scope: "user" }, "digest");
  assert.equal(session.navigate({ scope: "user" }), false);
  assert.equal(session.isCurrent(pending), true);
  session.navigate({ scope: "project", projectId: "proj_a" });
  session.navigate({ scope: "user" });
  assert.equal(session.isCurrent(pending), false);
  assert.equal(
    session.isCurrent(session.capture({ scope: "user" }, "new-digest")),
    true,
  );
});
