import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import {
  defineExtension,
  ExtensionError,
  type AccountInfo,
} from "@nervekit/extension-api";
import { ToolExecutionError } from "../../execution/index.js";
import { createQuickScriptRegistry } from "../registry.js";
import { accountKindIsTestable, testExtensionAccount } from "./account-test.js";

let server: Server;
let baseUrl = "";
const seen: { url: string; authorization?: string }[] = [];

before(async () => {
  server = createServer((request, response) => {
    seen.push({
      url: request.url ?? "",
      authorization: request.headers.authorization,
    });
    const url = request.url ?? "";
    if (url === "/refused") return void response.writeHead(401).end("no");
    if (url === "/slow-down") return void response.writeHead(429).end("later");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => void server.close());

const extension = defineExtension({
  id: "probe",
  apiVersion: 1,
  name: "Probe",
  description: "Test extension.",
  icon: "box",
  enabledByDefault: false,
  settings: {
    version: 1,
    fields: {
      account: { type: "account", kind: "probe", label: "Account" },
    },
  },
  accounts: {
    probe: {
      label: "Probe account",
      fields: { baseUrl: { type: "string", label: "Base URL", format: "url" } },
      secret: { label: "Token" },
      auth: { scheme: "bearer" },
      origins: ["{baseUrl}"],
      test: async (account, ctx) => {
        const selected = await ctx.accounts.selected("account");
        if (selected?.id !== account.id)
          return { ok: false, message: "The ctx is not bound to the account." };
        const path = String(account.fields.path ?? "/");
        if (path === "/incomplete")
          throw new ExtensionError("BAD_REQUEST", "Add the base URL first.");
        const response = await ctx.http.request({
          url: `${baseUrl}${path}`,
          auth: { account: "account" },
        });
        return response.ok
          ? { ok: true }
          : {
              ok: false,
              message: `HTTP ${response.status}`,
              reason: "unreachable",
            };
      },
    },
    plain: {
      label: "Plain account",
      fields: {},
      secret: { label: "Key" },
    },
  },
  permissions: { network: ["{account.baseUrl}"] },
  namespaces: [],
});

const registry = createQuickScriptRegistry([extension]);

const ports = (secret = "s3cret") => ({
  accounts: {
    get: async (kind: string, id: string): Promise<AccountInfo | undefined> =>
      kind === "probe" && id === "p1"
        ? { id, name: "P", kind, fields: { baseUrl } }
        : undefined,
    secret: async () => secret,
  },
});

const account = (path: string): AccountInfo => ({
  id: "p1",
  name: "P",
  kind: "probe",
  fields: { baseUrl, path },
});

void test("a kind is testable when its extension declares a hook", () => {
  assert.equal(accountKindIsTestable(registry, "probe"), true);
  assert.equal(accountKindIsTestable(registry, "plain"), false);
  assert.equal(accountKindIsTestable(registry, "missing"), false);
});

void test("the hook runs with a ctx bound to the account and its injected credential", async () => {
  seen.length = 0;
  const outcome = await testExtensionAccount({
    registry,
    ports: ports(),
    account: account("/ok"),
  });
  assert.deepEqual(outcome, { status: "verified" });
  assert.equal(seen[0].authorization, "Bearer s3cret");
});

void test("a refused credential is rejected, with the host's fix; other failures use the hook's reason", async () => {
  const refused = await testExtensionAccount({
    registry,
    ports: ports(),
    account: account("/refused"),
  });
  assert.equal(refused.status, "rejected");
  assert.match(refused.message ?? "", /Settings → Extensions → Probe/);
  const slow = await testExtensionAccount({
    registry,
    ports: ports(),
    account: account("/slow-down"),
  });
  assert.deepEqual(slow, { status: "unreachable", message: "HTTP 429" });
});

void test("an account missing what the test needs is ACCOUNT_INCOMPLETE; a kind without a hook cannot be tested", async () => {
  await assert.rejects(
    testExtensionAccount({
      registry,
      ports: ports(),
      account: account("/incomplete"),
    }),
    (error: unknown) =>
      error instanceof ToolExecutionError &&
      error.code === "ACCOUNT_INCOMPLETE",
  );
  await assert.rejects(
    testExtensionAccount({
      registry,
      ports: ports(),
      account: { id: "x", name: "X", kind: "plain", fields: {} },
    }),
    (error: unknown) =>
      error instanceof ToolExecutionError &&
      error.code === "ACCOUNT_NOT_TESTABLE",
  );
});
