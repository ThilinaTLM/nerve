import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createRemoteCredentialStore,
  type CredentialCipher,
} from "../src/daemon/adapters/remote-credential-store.ts";

const reversingCipher = (available = true): CredentialCipher => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from([...plain].reverse().join("")),
  decrypt: (encrypted) => [...encrypted.toString()].reverse().join(""),
});

async function fixture(available = true) {
  const dir = await mkdtemp(join(tmpdir(), "nerve-creds-"));
  const filePath = join(dir, "remote-credentials.json");
  const logs: string[] = [];
  const make = () =>
    createRemoteCredentialStore({
      filePath,
      cipher: reversingCipher(available),
      logger: { log: (_level, message) => void logs.push(message) },
    });
  return { filePath, logs, make };
}

describe("remote credential store", () => {
  it("persists credentials per origin, encrypted at rest", async () => {
    const { filePath, make } = await fixture();
    const store = make();
    await store.save("https://a.example", "nd_a.secret");
    await store.save("https://b.example", "nd_b.secret");

    const raw = await readFile(filePath, "utf8");
    assert.doesNotMatch(raw, /secret/);
    const reopened = make();
    assert.equal(await reopened.load("https://a.example"), "nd_a.secret");
    assert.equal(await reopened.load("https://b.example"), "nd_b.secret");
    assert.equal(await reopened.load("https://c.example"), undefined);

    await reopened.forget("https://a.example");
    assert.equal(await make().load("https://a.example"), undefined);
    assert.equal(await make().load("https://b.example"), "nd_b.secret");
  });

  it("keeps credentials in memory only when OS encryption is unavailable", async () => {
    const { filePath, logs, make } = await fixture(false);
    const store = make();
    await store.save("https://a.example", "nd_a.secret");
    assert.equal(await store.load("https://a.example"), "nd_a.secret");
    await assert.rejects(readFile(filePath, "utf8"), { code: "ENOENT" });
    assert.equal(await make().load("https://a.example"), undefined);
    assert.ok(logs.some((message) => /unavailable/.test(message)));
  });
});
