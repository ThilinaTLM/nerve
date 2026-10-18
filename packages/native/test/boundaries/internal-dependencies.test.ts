import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
// Package-local static checker deliberately has no runtime or native binding dependency.
// @ts-expect-error The check script is plain JavaScript, not a published TS API.
import {
  checkSource,
  checkTree,
} from "../../scripts/check-internal-dependencies.mjs";

test("native source tree obeys internal boundaries", () => {
  assert.deepEqual(
    checkTree(fileURLToPath(new URL("../../", import.meta.url))),
    [],
  );
});

test("TS domains reject sibling, aggregate and external package imports", () => {
  for (const source of [
    'import { read } from "../git/index.js";',
    'export * from "../index.js";',
    'type Binding = import("../binding/contract.js").NativeBinding;',
    'const load = () => import("../monitor/change-monitor.js");',
    'const sibling = require("../process/binding.js");',
    'import { value } from "@nervekit/contracts";',
  ])
    assert.notEqual(
      checkSource("src/search/query.ts", source).length,
      0,
      source,
    );
  assert.deepEqual(
    checkSource(
      "src/search/query.ts",
      'import { binding } from "../binding/loader.js"; import type { Query } from "./binding.js";',
    ),
    [],
  );
});

test("Rust domains and core reject sibling, grouped, escaping and N-API dependencies", () => {
  for (const [path, source] of [
    ["native/src/search/mod.rs", "use crate::git::read_snapshot;"],
    ["native/src/search/mod.rs", "use crate::{git, core};"],
    ["native/src/search/query.rs", "use super::super::git;"],
    ["native/src/core/runtime/mod.rs", "use crate::process::ManagedTarget;"],
    ["native/src/core/error.rs", "use napi::Error;"],
    ["native/src/search/query.rs", "use napi::Task;"],
    ["native/src/search/mod.rs", '#[path = "../git/mod.rs"] mod sibling;'],
  ])
    assert.notEqual(checkSource(path, source).length, 0, source);
  assert.deepEqual(
    checkSource(
      "native/src/search/query.rs",
      "use crate::core::cancellation::CancellationToken; use super::Query;",
    ),
    [],
  );
  assert.deepEqual(
    checkSource(
      "native/src/search/napi.rs",
      "use napi::Task; use crate::search::Query;",
    ),
    [],
  );
});

test("monitor cannot import Git even through the former polling seam", () => {
  assert.notEqual(
    checkSource(
      "native/src/monitor/git.rs",
      "use crate::git::{SnapshotOptions, read_repository_info, read_snapshot};",
    ).length,
    0,
  );
});

test("Rust relative paths account for file and inline module depth", () => {
  for (const [path, source] of [
    ["native/src/search/mod.rs", "use super::git;"],
    ["native/src/search/mod.rs", "mod tests { use super::super::git; }"],
    ["native/src/search/nested/mod.rs", "use super::super::git;"],
    ["native/src/search/nested/query.rs", "use super::super::super::git;"],
  ])
    assert.notEqual(checkSource(path, source).length, 0, source);
  assert.deepEqual(
    checkSource("native/src/search/mod.rs", "mod tests { use super::*; }"),
    [],
  );
  assert.deepEqual(
    checkSource(
      "native/src/search/nested/query.rs",
      "use super::super::Query;",
    ),
    [],
  );
});

test("Rust comments and raw strings neither invent dependencies nor hide following imports", () => {
  const masks = [
    "/* outer /* use crate::git::x; */ still a comment */",
    "// use crate::git::x;\n",
    'const S: &str = r###"use crate::git::x; /* " quote"###;',
    'const S: &[u8] = br#"use crate::git::x; //"#;',
    'const S: &str = "use crate::git::x;";',
    "const C: char = '\"';",
  ];
  for (const mask of masks) {
    assert.deepEqual(checkSource("native/src/search/query.rs", mask), [], mask);
    assert.notEqual(
      checkSource("native/src/search/query.rs", `${mask}\nuse crate::git::x;`)
        .length,
      0,
      mask,
    );
  }
});

test("TS domains may share core but TS core cannot reach domains, bindings or N-API", () => {
  assert.deepEqual(
    checkSource(
      "src/search/query.ts",
      'import { error } from "../core/error.js";',
    ),
    [],
  );
  assert.deepEqual(
    checkSource(
      "src/core/error.ts",
      'import { value } from "./value.js"; import { inspect } from "node:util";',
    ),
    [],
  );
  for (const source of [
    'import type { Query } from "../search/contracts.js";',
    'export * from "../git/contracts.js";',
    'const binding = () => import("../binding/loader.js");',
    'type Binding = import("../binding/contract.js").NativeBinding;',
    'const napi = require("@napi-rs/cli");',
    'import addon from "./native.node";',
    'import napi from "napi";',
  ])
    assert.notEqual(checkSource("src/core/error.ts", source).length, 0, source);
});
