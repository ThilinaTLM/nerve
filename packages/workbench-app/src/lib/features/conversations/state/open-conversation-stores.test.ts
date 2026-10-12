import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Retention is called from Svelte effects. Guard the tracking boundary at the
// owning layer so new callers cannot accidentally subscribe to the registry
// that their own retain/release lifecycle mutates.
test("conversation retention runs entirely outside reactive tracking", () => {
  const source = ts.createSourceFile(
    "open-conversation-stores.ts",
    readFileSync(
      new URL("./open-conversation-stores.ts", import.meta.url),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
  );
  const retain = source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "retainConversationStore",
  );
  assert.ok(retain?.body);
  assert.equal(retain.body.statements.length, 1);
  const statement = retain.body.statements[0]!;
  assert.ok(ts.isReturnStatement(statement));
  const call = statement.expression;
  assert.ok(call && ts.isCallExpression(call));
  assert.equal(call.expression.getText(source), "untrack");
  assert.equal(call.arguments.length, 1);
  assert.ok(ts.isArrowFunction(call.arguments[0]!));
});
