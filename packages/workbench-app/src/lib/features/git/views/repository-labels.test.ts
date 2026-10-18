import assert from "node:assert/strict";
import { test } from "node:test";
import { repositoryLabels as createRepositoryLabels } from "./repository-labels";

function repositoryLabels(...args: Parameters<typeof createRepositoryLabels>) {
  const result = createRepositoryLabels(...args);
  for (const { label } of result.values()) {
    assert.equal(label, label.toLowerCase());
    assert.match(
      label,
      /^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:-[\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*$/u,
    );
    assert.doesNotMatch(label, /[\s·/\\_…]|\.\.\.|--|^-|-$/u);
  }
  assert.equal(
    new Set([...result.values()].map(({ label }) => label)).size,
    result.size,
  );
  return result;
}

function repos(names: string[]) {
  return names.map((name, index) => ({
    id: String(index),
    name,
    path: `/repos/${name}`,
  }));
}

for (const { names, expected } of [
  {
    names: ["acme-platform-user-api", "acme-platform-admin-api"],
    expected: ["user-api", "admin-api"],
  },
  {
    names: ["acmePlatformUserAPI", "acme_platform_admin_API"],
    expected: ["user-api", "admin-api"],
  },
  {
    names: ["acme-platform-web-app", "acme-platform-user-ui"],
    expected: ["web-app", "user-ui"],
  },
  {
    names: ["équipeProjetUserAPI", "équipe_projet_admin_UI"],
    expected: ["user-api", "admin-ui"],
  },
  { names: ["internationalization"], expected: ["intrntnlztn"] },
]) {
  test(`semantic labels: ${names.join(", ")}`, () => {
    assert.deepEqual(
      [...repositoryLabels(repos(names)).values()].map(({ label }) => label),
      expected,
    );
  });
}

test("short names, camel, snake, acronyms and punctuation normalize to kebab case", () => {
  assert.deepEqual(
    [...repositoryLabels(repos(["my-repo", "UI", "工具"])).values()].map(
      ({ label }) => label,
    ),
    ["my-repo", "ui", "工具"],
  );
  for (const name of ["myRepo", "my_repo", "My Repo", "--my...repo--"]) {
    assert.equal(repositoryLabels(repos([name])).get("0")!.label, "my-repo");
  }
  assert.equal(
    repositoryLabels(repos(["apiUser"])).get("0")!.label,
    "api-user",
  );
});

test("never strips partial words or an entire shorter name", () => {
  assert.deepEqual(
    [
      ...repositoryLabels(repos(["planet-user-api", "platform-admin-api"]), {
        maxLength: 64,
      }).values(),
    ].map(({ label }) => label),
    ["planet-user-api", "platform-admin-api"],
  );
  assert.deepEqual(
    [...repositoryLabels(repos(["acme", "acme-api"])).values()].map(
      ({ label }) => label,
    ),
    ["acme", "acme-api"],
  );
});

test("abbreviates earlier words without losing semantic tails", () => {
  const result = repositoryLabels(
    repos(["configuration-management-user-api", "development-web-app"]),
  );
  assert.match(result.get("0")!.label, /user-api$/);
  assert.match(result.get("1")!.label, /web-app$/);
  assert.match(result.get("0")!.reason, /Abbreviated/);
  assert.equal(
    repositoryLabels(repos(["configuration-user-api"]), { maxLength: 10 }).get(
      "0",
    )!.label,
    "c-user-api",
  );
});

test("expands compressed collisions before adding context or identities", () => {
  // Both abbreviate to a-m-user-api; full words fit a larger budget only.
  const input = repos([
    "alpha-marketing-user-api",
    "amber-monitoring-user-api",
  ]);
  const result = repositoryLabels(input);
  for (const { label, reason } of result.values()) {
    assert.match(reason, /Expanded/);
    assert.match(label, /^user-api-[a-z0-9]{4}$/);
  }
});

test("duplicate basenames get shortest distinguishing parent context", () => {
  const result = repositoryLabels([
    { id: "a", name: "app", path: "/home/east/work/app" },
    { id: "b", name: "app", path: "/home/west/work/app" },
  ]);
  assert.equal(result.get("a")!.label, "app-east-work");
  assert.equal(result.get("b")!.label, "app-west-work");
  const windows = repositoryLabels([
    { id: "a", name: "app", path: "C:\\east\\app" },
    { id: "b", name: "app", path: "C:\\west\\app" },
  ]);
  assert.equal(windows.get("a")!.label, "app-east");
  assert.equal(windows.get("b")!.label, "app-west");
});

test("normalization collisions and identical paths use stable identities regardless of input order", () => {
  const input = [
    { id: "z", name: "foo_bar", path: "/Same Parent/foo_bar" },
    { id: "b", name: "foo-bar", path: "/same_parent/foo-bar" },
    { id: "a", name: "Foo Bar", path: "/same-parent/Foo Bar" },
  ];
  for (const maxLength of [14, 64]) {
    const result = repositoryLabels(input, { maxLength });
    assert.deepEqual(
      repositoryLabels(input.slice().reverse(), { maxLength }),
      result,
    );
    for (const { reason } of result.values())
      assert.match(reason, /stable identifier/);
  }
});

test("parent-context aliases cannot collide with another repository's ordinary name", () => {
  const input = [
    { id: "a", name: "app", path: "/east/app" },
    { id: "b", name: "app", path: "/west/app" },
    { id: "c", name: "app-east", path: "/elsewhere/app-east" },
  ];
  const result = repositoryLabels(input);
  assert.equal(result.get("b")!.label, "app-west");
  assert.notEqual(result.get("a")!.label, result.get("c")!.label);
  assert.deepEqual(repositoryLabels(input.slice().reverse()), result);
});

test("compact fallback bounds opaque words, acronyms and long duplicate parents", () => {
  const input = [
    { id: "a", name: "strengthsstrengthsstrengths", path: "/words/long" },
    {
      id: "b",
      name: "configuration-management-user-api",
      path: "/extraordinarily-long-east-parent/api",
    },
    {
      id: "c",
      name: "configuration-management-user-api",
      path: "/extraordinarily-long-west-parent/api",
    },
    { id: "d", name: "EXTRAORDINARYACRONYM", path: "/acronym" },
  ];
  for (const maxLength of [9, 10, 12, 14, 16, 22]) {
    const result = repositoryLabels(input, { maxLength });
    assert.deepEqual(
      repositoryLabels(input.slice().reverse(), { maxLength }),
      result,
    );
    for (const { label } of result.values())
      assert.ok(Array.from(label).length <= maxLength);
  }
  const result = repositoryLabels(input);
  assert.match(result.get("a")!.label, /^repo-[a-z0-9]{4}$/);
  assert.match(result.get("b")!.label, /^user-api-[a-z0-9]{4}$/);
});

test("compact identifiers avoid reserved readable labels deterministically", () => {
  const long = {
    id: "long",
    name: "strengthsstrengthsstrengths",
    path: "/words/long",
  };
  const initial = repositoryLabels([long]).get("long")!.label;
  const input = [long, { id: "ordinary", name: initial, path: "/ordinary" }];
  const result = repositoryLabels(input);
  assert.equal(result.get("ordinary")!.label, initial);
  assert.notEqual(result.get("long")!.label, initial);
  assert.deepEqual(repositoryLabels(input.slice().reverse()), result);
});

test("budgets default to 14, clamp to nine and count Unicode code points", () => {
  for (const maxLength of [2, -1, 9.9]) {
    assert.equal(
      repositoryLabels(repos(["strengthsstrengthsstrengths"]), {
        maxLength,
      }).get("0")!.label.length,
      9,
    );
  }
  const input = repos(["strengthsstrengthsstrengths"]);
  for (const maxLength of [Number.NaN, Infinity, -Infinity]) {
    assert.deepEqual(
      repositoryLabels(input, { maxLength }),
      repositoryLabels(input),
    );
  }
  assert.equal(
    repositoryLabels(repos(["𐐨𐐩𐐪𐐫𐐬𐐭𐐮𐐯𐐰𐐱"])).get("0")!.label,
    "𐐨𐐩𐐪𐐫𐐬𐐭𐐮𐐯𐐰𐐱",
  );
});

test("empty names and Unicode canonical/case collisions are safe without mutating input", () => {
  assert.equal(repositoryLabels([]).size, 0);
  const input = [
    ...repos(["", "", "API", "api"]),
    { id: "a", name: "ÉquipeUserAPI", path: "/MÊME_PARENT/a" },
    { id: "b", name: "e\u0301quipe_user_api", path: "/même parent/b" },
    { id: "c", name: "工具 Web UI", path: "/工具/c" },
    { id: "d", name: "İstanbul_UI", path: "/İstanbul/d" },
  ];
  const snapshot = structuredClone(input);
  const result = repositoryLabels(input);
  assert.equal(result.size, input.length);
  assert.equal(result.get("c")!.label, "工具-web-ui");
  assert.equal(result.get("d")!.label, "i\u0307stanbul-ui");
  assert.deepEqual(repositoryLabels(input.slice().reverse()), result);
  assert.deepEqual(input, snapshot);
});
