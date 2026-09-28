import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { asyncSubagentToolNames } from "@nervekit/contracts/agents";
import { defaultHarnessConfig } from "@nervekit/contracts/settings";
import {
  HOME_CONFIGURATION_CODECS,
  upgradeHarnessV1ToV2,
  upgradePermissionsV1ToV2,
} from "../../../src/infrastructure/configuration/home-configuration-codecs.js";
import {
  HomeConfigurationDocumentError,
  initializeHomeConfiguration,
  readHomeConfiguration,
  writeHomeConfiguration,
} from "../../../src/infrastructure/configuration/home-configuration.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/paths.js";

const fixtures = join(import.meta.dirname, "fixtures");

describe("home configuration upgraders", () => {
  it("upgrades the harness v1 fixture without mutating or dropping extensions", async () => {
    const fixture = await fixtureJson("harness-v1.json");
    const upgraded = upgradeHarnessV1ToV2(fixture) as Record<string, unknown>;
    const tools = upgraded.tools as Record<string, unknown>;

    assert.equal(upgraded.version, 2);
    assert.deepEqual(upgraded.futureHarnessOption, { enabled: true });
    assert.equal(tools.futureToolOption, true);
    assert.deepEqual(tools.disabled, ["explore", ...asyncSubagentToolNames]);
    assert.equal((fixture as { version: number }).version, 1);
  });

  it("upgrades the permissions v1 fixture into the baseline overlay", async () => {
    const fixture = await fixtureJson("permissions-v1.json");
    const upgraded = upgradePermissionsV1ToV2(fixture) as {
      schemaVersion: number;
      overlays: Array<{ ruleSetId: string; rules: unknown[] }>;
      futurePermissionOption: boolean;
    };

    assert.equal(upgraded.schemaVersion, 2);
    assert.equal(upgraded.overlays[0]?.ruleSetId, "baseline");
    assert.equal(upgraded.overlays[0]?.rules.length, 1);
    assert.equal(upgraded.futurePermissionOption, true);
    assert.equal((fixture as { schemaVersion: number }).schemaVersion, 1);
  });
});

describe("home configuration document codecs", () => {
  it("reads legacy documents and preserves unknown object fields across writes", async (t) => {
    const home = await mkdtemp(join(tmpdir(), "nerve-config-codecs-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const paths = storagePaths(home);
    await initializeHomeConfiguration(paths);

    const harnessFixture = await fixtureJson("harness-v1.json");
    const harness = structuredClone(defaultHarnessConfig) as unknown as Record<
      string,
      unknown
    >;
    Object.assign(harness, harnessFixture);
    harness.tools = {
      ...(defaultHarnessConfig.tools as unknown as Record<string, unknown>),
      ...((harnessFixture as Record<string, unknown>).tools as Record<
        string,
        unknown
      >),
    };
    await writeFile(paths.harnessConfigPath, JSON.stringify(harness));
    await writeFile(
      paths.permissionsConfigPath,
      JSON.stringify(await fixtureJson("permissions-v1.json")),
    );

    const daemonRaw = JSON.parse(
      await readFile(paths.daemonConfigPath, "utf8"),
    ) as Record<string, unknown>;
    daemonRaw.futureDaemonOption = { retained: true };
    daemonRaw.network = {
      ...(daemonRaw.network as Record<string, unknown>),
      futureNetworkOption: "retained",
    };
    await writeFile(paths.daemonConfigPath, JSON.stringify(daemonRaw));

    const configuration = await readHomeConfiguration(paths);
    const decodedHarness = configuration.harness as unknown as Record<
      string,
      unknown
    >;
    const decodedDaemon = configuration.daemon as unknown as Record<
      string,
      unknown
    >;
    assert.equal(configuration.harness.version, 2);
    assert.deepEqual(decodedHarness.futureHarnessOption, { enabled: true });
    assert.deepEqual(decodedDaemon.futureDaemonOption, { retained: true });
    assert.equal(
      (decodedDaemon.network as Record<string, unknown>).futureNetworkOption,
      "retained",
    );
    assert.equal(configuration.permissions.schemaVersion, 2);
    assert.equal(configuration.permissions.overlays[0]?.ruleSetId, "baseline");

    await writeHomeConfiguration(paths, configuration);
    const persistedDaemon = JSON.parse(
      await readFile(paths.daemonConfigPath, "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(persistedDaemon.futureDaemonOption, { retained: true });
  });

  it("identifies the invalid document and path", async (t) => {
    const home = await mkdtemp(join(tmpdir(), "nerve-config-invalid-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const paths = storagePaths(home);
    await initializeHomeConfiguration(paths);
    await writeFile(
      paths.harnessConfigPath,
      JSON.stringify({
        ...defaultHarnessConfig,
        tools: { ...defaultHarnessConfig.tools, disabled: ["not-a-tool"] },
      }),
    );

    await assert.rejects(
      () => readHomeConfiguration(paths),
      (error: unknown) => {
        assert.ok(error instanceof HomeConfigurationDocumentError);
        assert.equal(error.documentId, "harness");
        assert.equal(error.path, paths.harnessConfigPath);
        assert.match(error.message, /harness configuration/);
        return true;
      },
    );
  });

  it("rejects a future embedded version through its document codec", () => {
    assert.throws(
      () =>
        HOME_CONFIGURATION_CODECS.harness.decode({
          ...defaultHarnessConfig,
          version: 99,
        }),
      /newer than supported version 2/,
    );
  });
});

async function fixtureJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(fixtures, name), "utf8")) as unknown;
}
