import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  defaultProvidersConfig,
  NERVE_HOME_MANIFEST,
} from "@nervekit/contracts/settings";
import { EncryptedFileSecretProvider } from "../secrets/index.js";
import { readArchivedHome, startFreshHome } from "./start-fresh.js";
import { readMigrationHome } from "../migrations/framework/ledger.js";
import { initializeStorage } from "./initialize.js";
import { ensureLocalToken } from "./local-token.js";
import { storagePaths } from "./paths.js";

for (const scenario of [
  "valid",
  "invalid-providers",
  "missing-key",
  "missing-credentials",
  "invalid-pair",
  "unknown-layout",
  "invalid-manifest",
  "damaged-ledger",
] as const) {
  void test(`start fresh preserves original and follows copy rules: ${scenario}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "nerve-fresh-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const home = join(root, "home");
    await mkdir(join(home, "config"), { recursive: true });
    if (scenario !== "unknown-layout")
      await writeFile(
        join(home, "manifest.json"),
        scenario === "invalid-manifest"
          ? "{"
          : JSON.stringify({
              ...NERVE_HOME_MANIFEST,
              ...(scenario === "damaged-ledger"
                ? { migrations: "broken" }
                : {}),
            }),
      );
    const providers =
      scenario === "invalid-providers"
        ? '{"version":0}'
        : JSON.stringify(defaultProvidersConfig);
    await writeFile(join(home, "config/providers.json"), providers);
    const secrets = new EncryptedFileSecretProvider(home);
    await secrets.initialize();
    await secrets.set("provider", "secret");
    if (scenario === "missing-key") await rm(join(home, "secrets/master.key"));
    if (scenario === "missing-credentials")
      await rm(join(home, "secrets/credentials.enc"));
    if (scenario === "invalid-pair")
      await writeFile(join(home, "secrets/credentials.enc"), "broken");
    await writeFile(join(home, "history"), "never delete");
    const originalCredentials = await readFile(
      join(home, "secrets/credentials.enc"),
    ).catch(() => undefined);
    await writeFile(join(home, "secrets/daemon-token"), "old-token");
    const archive = await startFreshHome(home);
    const newToken = await ensureLocalToken(home);
    assert.ok(newToken.ok);
    assert.notEqual(newToken.ok && newToken.token, "old-token");
    assert.ok(archive.startsWith(`${home}.archive-`));
    assert.equal(await readArchivedHome(home), archive);
    assert.equal(
      await readFile(join(archive, "history"), "utf8"),
      "never delete",
    );
    assert.equal(
      await readFile(join(archive, "config/providers.json"), "utf8"),
      providers,
    );
    assert.deepEqual(
      await readFile(join(archive, "secrets/credentials.enc")).catch(
        () => undefined,
      ),
      originalCredentials,
    );
    await assert.rejects(readFile(join(home, "history")), { code: "ENOENT" });
    assert.ok(
      (await readMigrationHome(storagePaths(home))).manifest.migrations?.length,
    );
    const recognizable = !["unknown-layout", "invalid-manifest"].includes(
      scenario,
    );
    if (recognizable && scenario !== "invalid-providers")
      assert.equal(
        await readFile(join(home, "config/providers.json"), "utf8"),
        providers,
      );
    else
      assert.deepEqual(
        JSON.parse(await readFile(join(home, "config/providers.json"), "utf8")),
        defaultProvidersConfig,
      );
    if (
      recognizable &&
      !["missing-key", "missing-credentials", "invalid-pair"].includes(scenario)
    ) {
      assert.deepEqual(
        await readFile(join(home, "secrets/credentials.enc")),
        originalCredentials,
      );
      assert.equal(
        await new EncryptedFileSecretProvider(home).get("provider"),
        "secret",
      );
      assert.equal(
        (await lstat(join(home, "secrets/master.key"))).mode & 0o777,
        0o600,
      );
    } else {
      assert.deepEqual(await new EncryptedFileSecretProvider(home).list(), []);
      assert.notDeepEqual(
        await readFile(join(home, "secrets/credentials.enc")),
        originalCredentials,
      );
    }
    const initialized = await initializeStorage(home);
    assert.equal(initialized.localToken, newToken.ok && newToken.token);
    await rm(archive, { recursive: true });
    assert.equal(await readArchivedHome(home), undefined);
  });
}
