import assert from "node:assert/strict";
import { test } from "node:test";
import {
  launchEntryIdentity,
  restoredLaunchEntryExists,
} from "./launch-entry-identity";

test("definition tab identities disambiguate portable IDs and encode boundaries", () => {
  const first = launchEntryIdentity({
    id: "run_a",
    projectId: "proj_a",
    definitionId: "launchdef_shared",
  });
  const second = launchEntryIdentity({
    id: "run_b",
    projectId: "proj_b",
    definitionId: "launchdef_shared",
  });
  assert.notEqual(first, second);
  assert.equal(
    first,
    launchEntryIdentity({
      id: "run_other",
      projectId: "proj_a",
      definitionId: "launchdef_shared",
    }),
  );
  assert.notEqual(
    launchEntryIdentity({ id: "a", projectId: "p:x", definitionId: "y" }),
    launchEntryIdentity({ id: "b", projectId: "p", definitionId: "x:y" }),
  );
});
test("standalone run and restart-chain identities retain their existing behavior", () => {
  assert.equal(launchEntryIdentity({ id: "run_a" }), "run_a");
  assert.equal(
    launchEntryIdentity({ id: "run_b", restartRootLaunchId: "run_a" }),
    "run_a",
  );
});

test("restoration rejects another project's copied definition and keeps standalone tabs", () => {
  const a = {
    id: "run_a",
    projectId: "proj_a",
    definitionId: "launchdef_shared",
  };
  const b = {
    id: "run_b",
    projectId: "proj_b",
    definitionId: "launchdef_shared",
  };
  assert.equal(
    restoredLaunchEntryExists(launchEntryIdentity(a), "proj_b", [a, b]),
    false,
  );
  assert.equal(
    restoredLaunchEntryExists(launchEntryIdentity(b), "proj_b", [a, b]),
    true,
  );
  assert.equal(
    restoredLaunchEntryExists("launchdef_shared", "proj_b", [a, b]),
    false,
  );
  assert.equal(
    restoredLaunchEntryExists("run_standalone", "proj_b", [
      { id: "run_standalone" },
    ]),
    true,
  );
});
