import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import {
  ConfigurationScopePaths,
  userConfigurationRoot,
} from "./scope-paths.js";

function fixture() {
  return new ConfigurationScopePaths({
    userConfigPath: userConfigurationRoot("/nerve-home"),
    conversationsPath: "/nerve-home/data/conversations",
    projectDirectory: (id) => (id === "project" ? "/workspace" : undefined),
    projectOf: (id) => {
      if (id !== "conv_123") throw new Error("Conversation not found");
      return "project";
    },
  });
}

void test("canonical roots preserve domain filenames and protection boundaries", () => {
  const paths = fixture();
  for (const filename of [
    "capabilities.json",
    "subagents.json",
    "permissions.json",
    "harness.json",
  ]) {
    assert.deepEqual(paths.resolve({ scope: "user" }, filename), {
      path: join("/nerve-home/config", filename),
      root: "/nerve-home/config",
    });
    assert.deepEqual(
      paths.resolve({ scope: "project", projectId: "project" }, filename),
      {
        path: join("/workspace/.nerve/config", filename),
        root: "/workspace",
        projectId: "project",
      },
    );
    assert.deepEqual(
      paths.resolve(
        { scope: "conversation", conversationId: "conv_123" },
        filename,
      ),
      {
        path: join("/nerve-home/data/conversations/conv_123/config", filename),
        root: "/nerve-home/data/conversations",
        projectId: "project",
        conversationId: "conv_123",
      },
    );
  }
});

void test("conversation paths require a real owner and reject cross-project access", () => {
  const paths = fixture();
  assert.throws(
    () =>
      paths.resolve({ scope: "project", projectId: "missing" }, "harness.json"),
    /Project not found/,
  );
  assert.throws(
    () =>
      paths.resolve(
        { scope: "conversation", conversationId: "missing" },
        "harness.json",
      ),
    /Conversation not found/,
  );
  assert.throws(
    () =>
      paths.resolve(
        {
          scope: "conversation",
          conversationId: "conv_123",
          projectId: "other",
        },
        "harness.json",
      ),
    /does not belong/,
  );
  assert.throws(
    () =>
      paths.resolve(
        { scope: "conversation", projectId: "project" },
        "harness.json",
      ),
    /conversation is required/,
  );
  assert.throws(
    () => paths.resolve({ scope: "project" }, "harness.json"),
    /project is required/,
  );
});

void test("identifiers and filenames cannot escape their scope", () => {
  const paths = fixture();
  for (const conversationId of [
    "",
    ".",
    "..",
    "../conv_123",
    "a/b",
    "a\\b",
    "/absolute",
    "a\u0000b",
  ]) {
    assert.throws(
      () =>
        paths.resolve(
          { scope: "conversation", conversationId },
          "harness.json",
        ),
      /Invalid conversation id/,
    );
  }
  for (const filename of [
    "",
    ".",
    "..",
    "../harness.json",
    "/tmp/harness.json",
    "config\\harness.json",
  ]) {
    assert.throws(
      () => paths.resolve({ scope: "user" }, filename),
      /Invalid configuration filename/,
    );
  }
});

void test("explicit owner roots stay in place without inferred relocation", () => {
  const paths = new ConfigurationScopePaths({
    userConfigPath: "/custom/settings",
    conversationsPath: "/custom/conversations",
    projectOf: () => "project",
  });
  assert.equal(
    paths.resolve({ scope: "user" }, "custom profiles.json").path,
    "/custom/settings/custom profiles.json",
  );
  assert.equal(
    paths.resolve(
      { scope: "conversation", conversationId: "child" },
      "subagents.json",
    ).path,
    "/custom/conversations/child/config/subagents.json",
  );
  assert.throws(
    () =>
      new ConfigurationScopePaths({ conversationsPath: "/custom" }).resolve(
        { scope: "conversation", conversationId: "child" },
        "harness.json",
      ),
    /ownership resolver/,
  );
});
