import type { QuickScriptNestedRequest } from "../../execution/index.js";

/** A recorded nested check, as quick-script tests collect them from `authorizeNested`. */
export type Nested = QuickScriptNestedRequest;

/** The operation (`jira.issues.get`), or the direct tool name for `web.*` and `files.*` checks. */
export const nestedName = (request: Nested): string =>
  "operation" in request ? request.operation : request.toolName;
