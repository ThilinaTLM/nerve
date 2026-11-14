import assert from "node:assert/strict";
import test from "node:test";
import {
  createSdkEnvironment,
  findSdkMethod,
} from "@nervekit/tools/quick-script/runtime/sdk";
import { STORAGE_PRELUDE } from "@nervekit/tools/quick-script/runtime/files/storage-helpers";
import { renderLimits } from "@nervekit/tools/quick-script/limits";
import { registeredMethods, registeredNamespaces } from "./install.js";

const topics = registeredNamespaces.flatMap((namespace) =>
  namespace.docs.map((topic) => ({ namespace, topic })),
);
const rendered = topics.map(({ namespace, topic }) => ({
  id: topic.id,
  text: renderLimits(namespace.readDoc(topic.file)),
}));

async function run(method: string, ...args: unknown[]) {
  const env = createSdkEnvironment({ cwd: process.cwd() });
  return String(await findSdkMethod(method)!.prepare(args, env).run(env));
}

void test("topic ids are unique and live under their namespace", () => {
  assert.equal(
    new Set(topics.map(({ topic }) => topic.id)).size,
    topics.length,
  );
  for (const { namespace, topic } of topics)
    assert.ok(topic.id.startsWith(`${namespace.id}/`), topic.id);
  assert.ok(topics.length >= 10);
});

void test("every topic renders with its limits filled and links only to existing topics or namespaces", () => {
  const ids = new Set([
    ...topics.map(({ topic }) => topic.id),
    ...registeredNamespaces.map((namespace) => namespace.id),
  ]);
  let links = 0;
  for (const { id, text } of rendered) {
    assert.doesNotMatch(text, /\{\{/, `${id} has an unfilled placeholder`);
    assert.doesNotMatch(
      text,
      /\]\([\w./-]+\.(?:md|d\.ts)\)/,
      `${id} links to a file`,
    );
    for (const [, target] of text.matchAll(/sdk\.docs\("([^"]+)"\)/g)) {
      assert.ok(ids.has(target), `${id} links to missing topic ${target}`);
      links += 1;
    }
  }
  assert.ok(links > 5);
});

void test("namespace rules and describe output link only to existing topics", async () => {
  const ids = new Set(topics.map(({ topic }) => topic.id));
  for (const namespace of registeredNamespaces) {
    const text = await run("sdk.describe", namespace.id);
    for (const [, target] of text.matchAll(/sdk\.docs\("([^"]+)"\)/g))
      assert.ok(
        ids.has(target) || target === namespace.id,
        `${namespace.id}: ${target}`,
      );
  }
});

void test("SDK calls and storage helpers named in the docs exist", () => {
  const sdk = new Set(
    registeredMethods.map((method) => `${method.product}.${method.path}`),
  );
  const returned = STORAGE_PRELUDE.slice(
    STORAGE_PRELUDE.lastIndexOf("return {"),
  );
  const storage = new Set(
    [...returned.matchAll(/^ {4}(\w+)(?::|,)/gm)].map((m) => m[1]),
  );
  const names = registeredNamespaces
    .filter((namespace) => namespace.methods.length > 0)
    .map((namespace) => namespace.id)
    .join("|");
  let checked = 0;
  for (const { id, text } of rendered) {
    for (const [, name] of text.matchAll(
      new RegExp(`\\b((?:${names})(?:\\.\\w+)+)\\(`, "g"),
    )) {
      assert.ok(sdk.has(name), `${id} uses unknown ${name}(`);
      checked += 1;
    }
    for (const [, name] of text.matchAll(/\bstorage\.(\w+)\(/g)) {
      assert.ok(storage.has(name), `${id} uses unknown storage.${name}(`);
      checked += 1;
    }
  }
  assert.ok(checked > 10);
});

void test("storage/builders documents every storage helper", () => {
  const returned = STORAGE_PRELUDE.slice(
    STORAGE_PRELUDE.lastIndexOf("return {"),
  );
  const helpers = [...returned.matchAll(/^ {4}(\w+)(?::|,)/gm)].map(
    (m) => m[1],
  );
  assert.ok(helpers.length > 0);
  const text = rendered.find((entry) => entry.id === "storage/builders")!.text;
  for (const name of helpers)
    assert.ok(
      text.includes(`\`storage.${name}(`),
      `storage/builders misses ${name}`,
    );
});

void test("limits come from code", () => {
  assert.equal(
    renderLimits(
      "{{limit:files.read}} {{limit:attachments}} {{limit:diagram.source}}",
    ),
    "20 MiB 100 MiB 128 KiB",
  );
  assert.throws(() => renderLimits("{{limit:nope}}"), /Unknown limit/);
});
