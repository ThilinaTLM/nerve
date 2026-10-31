import assert from "node:assert/strict";
import { test } from "node:test";
import { repositoryLabels as createRepositoryLabels } from "./repository-labels";

type Input = Parameters<typeof createRepositoryLabels>[0];

/** Every result is unique, lowercase kebab-case, never ellipsized and order independent. */
function labels(input: Input, maxLength?: number): string[] {
  const options = maxLength ? { maxLength } : {};
  const result = createRepositoryLabels(input, options);
  const values = input.map((repo) => result.get(repo.id)!.label);
  for (const label of values) {
    assert.equal(label, label.toLowerCase());
    assert.match(
      label,
      /^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:-[\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*$/u,
    );
    assert.doesNotMatch(label, /…|\.\.\./u);
  }
  assert.equal(new Set(values).size, values.length);
  assert.deepEqual(
    createRepositoryLabels(input.slice().reverse(), options),
    result,
  );
  return values;
}

function repos(names: string[]): Input {
  return names.map((name, index) => ({
    id: String(index),
    name,
    path: `/work/${name}`,
  }));
}

test("removes words every repository shares at the start or end", () => {
  assert.deepEqual(
    labels(
      repos([
        "acme-platform-user-api",
        "acme-platform-admin-api",
        "acme-platform-web-app",
      ]),
    ),
    ["user-api", "admin-api", "web-app"],
  );
  assert.deepEqual(
    labels(repos(["acme-user-service", "acme-billing-service"])),
    ["user", "billing"],
  );
});

test("families drop the leading words they share, even beside unrelated repositories", () => {
  assert.deepEqual(
    labels(
      repos([
        "acme-customer-platform-user-api",
        "acme-customer-platform-web-app",
        "nerve",
      ]),
    ),
    ["user-api", "web-app", "nerve"],
  );
  // Families that end the same way keep their leading words.
  assert.deepEqual(
    labels(
      repos([
        "acme-user-api",
        "acme-web-app",
        "beta-user-api",
        "beta-admin-ui",
      ]),
    ),
    ["acme-user-api", "web-app", "beta-user-api", "admin-ui"],
  );
});

test("parent folders are added only where a label still collides", () => {
  assert.deepEqual(
    labels([
      { id: "a", name: "acme-platform-user-api", path: "/w/a" },
      { id: "b", name: "acme-platform-web-app", path: "/w/b" },
      { id: "c", name: "api", path: "/w/user/api" },
      { id: "d", name: "api", path: "/w/admin/api" },
    ]),
    ["user-api", "web-app", "w-user-api", "admin-api"],
  );
});

test("splits camel, snake and kebab case the same way", () => {
  assert.deepEqual(
    labels(
      repos([
        "acmePlatformUserAPI",
        "acme_platform_admin_ui",
        "acme-platform-web-app",
      ]),
    ),
    ["user-api", "admin-ui", "web-app"],
  );
  assert.deepEqual(labels(repos(["acme-front-end", "acme-back-end"])), [
    "frontend",
    "backend",
  ]);
});

test("never removes role words, even when every repository shares them", () => {
  assert.deepEqual(labels(repos(["acme-user-api", "acme-admin-api"])), [
    "user-api",
    "admin-api",
  ]);
  assert.deepEqual(labels(repos(["api-user", "api-admin"])), [
    "api-user",
    "api-admin",
  ]);
});

test("never strips short leading words such as no", () => {
  assert.deepEqual(labels(repos(["no-remote", "no-upstream"])), [
    "no-remote",
    "no-upstream",
  ]);
  assert.deepEqual(
    labels(repos(["no-remote-api", "no-upstream-api", "other"]), 16),
    ["no-remote-api", "no-upstream-api", "other"],
  );
});

test("keeps at least one word per repository", () => {
  assert.deepEqual(labels(repos(["acme", "acme-api"])), ["acme", "acme-api"]);
});

test("long names shorten words from the left to two letters and keep role words whole", () => {
  assert.deepEqual(labels(repos(["customer-user-api", "billing-service"])), [
    "cu-user-api",
    "bi-service",
  ]);
  assert.deepEqual(
    labels(
      repos([
        "customer-onboarding-platform-api",
        "payments-reconciliation-worker",
        "marketing-site-frontend",
        "shared-infrastructure-iac",
      ]),
    ),
    ["cuonpl-api", "pare-worker", "masi-frontend", "shin-iac"],
  );
});

test("short names stay as they are", () => {
  assert.deepEqual(labels(repos(["nerve", "api", "ui-kit"])), [
    "nerve",
    "api",
    "ui-kit",
  ]);
});

test("colliding abbreviations use more letters before full words", () => {
  assert.deepEqual(
    labels(repos(["marketing-user-api", "maintenance-user-api", "other"]), 12),
    ["mar-user-api", "mai-user-api", "other"],
  );
});

test("duplicate names lead with the nearest distinguishing parent folder", () => {
  assert.deepEqual(
    labels([
      { id: "a", name: "api", path: "/work/user/api" },
      { id: "b", name: "api", path: "C:\\work\\admin\\api" },
      { id: "c", name: "ui", path: "/work/ui" },
    ]),
    ["user-api", "admin-api", "ui"],
  );
});

test("names that differ only by punctuation are numbered without colliding", () => {
  assert.deepEqual(
    labels([
      { id: "a", name: "foo-bar", path: "/same/foo-bar" },
      { id: "b", name: "foo_bar", path: "/same/foo_bar" },
      { id: "c", name: "foo-bar-2", path: "/same/foo-bar-2" },
    ]),
    // "foo" is shared by all three, so it is removed first.
    ["bar", "bar-3", "bar-2"],
  );
});

test("a single long word keeps its outline instead of being cut", () => {
  assert.deepEqual(labels(repos(["internationalization"])), ["intrntnlztn"]);
});

test("empty names and Unicode are safe without mutating input", () => {
  const input = [
    ...repos(["", "工具 Web UI"]),
    { id: "x", name: "équipe_user_api", path: "/x" },
  ];
  const snapshot = structuredClone(input);
  assert.deepEqual(labels(input), ["repo", "工具-web-ui", "éq-user-api"]);
  assert.deepEqual(input, snapshot);
  assert.equal(createRepositoryLabels([]).size, 0);
});
