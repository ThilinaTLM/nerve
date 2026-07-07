import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type {
  ManagedContainerCreateSpec,
  SandboxManagerCredentialProfile,
} from "@nervekit/shared";
import { applyCredentialProfiles } from "../src/config/apply-credential-profiles.js";
import { containerCreateArgs } from "../src/drivers/container-args.js";
import { validateManagedContainerCreateSpec } from "../src/drivers/validation.js";
import { SandboxEventIngestor } from "../src/events/sandbox-event-ingestor.js";
import { EventStore } from "../src/state/event-store.js";

function spec(): ManagedContainerCreateSpec {
  return {
    sandboxId: "sbx_1",
    instanceId: "inst_1",
    image: "nerve-sandbox-agent:dev",
    env: { A: "B" },
    labels: { "org.nerve.sandbox.spec": "v1" },
    mounts: [
      { kind: "bind", source: "/tmp/workspace", target: "/workspace" },
      { kind: "bind", source: "/tmp/state", target: "/state" },
    ],
    security: {
      readOnlyRootFilesystem: true,
      noNewPrivileges: true,
      capDrop: ["ALL"],
    },
  };
}

describe("sandbox manager driver and event foundations", () => {
  it("generates secure Docker/Podman create args", () => {
    const args = containerCreateArgs(spec());
    assert.ok(args.includes("--read-only"));
    assert.ok(args.includes("no-new-privileges"));
    assert.ok(args.includes("--cap-drop"));
  });

  it("rejects prohibited production mounts", () => {
    const invalid = spec();
    invalid.mounts.push({
      kind: "bind",
      source: "/var/run/docker.sock",
      target: "/docker.sock",
    });
    assert.ok(
      validateManagedContainerCreateSpec(invalid, { production: true }).some(
        (error) => error.includes("prohibited"),
      ),
    );
  });

  it("applies pi-ai provider env and credentials to model catalog", () => {
    const now = new Date().toISOString();
    const profile: SandboxManagerCredentialProfile = {
      profileId: "cred_1",
      kind: "model_provider",
      providerKind: "cloudflare_ai_gateway_api_key",
      displayName: "Cloudflare AI Gateway",
      provider: "cloudflare-ai-gateway",
      baseUrl:
        "https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/anthropic",
      env: {
        CLOUDFLARE_ACCOUNT_ID: "account-id",
        CLOUDFLARE_GATEWAY_ID: "gateway-id",
      },
      authType: "api_key",
      status: "configured",
      secretRefs: [{ purpose: "api-key", configured: true }],
      credential: {
        type: "api_key",
        apiKey: { kv: { key: "credentials/cred_1/api-key" } },
      },
      createdAt: now,
      updatedAt: now,
    };

    const config = applyCredentialProfiles(
      {
        version: 1,
        agent: {
          mainModel: {
            provider: "cloudflare-ai-gateway",
            model: "claude-sonnet-4-5",
          },
        },
      },
      [profile],
      { sandboxId: "sbx_1", managerHttpBaseUrl: "http://manager" },
    );

    const provider = config.modelCatalog?.providers?.[0];
    assert.equal(provider?.id, "cloudflare-ai-gateway");
    assert.equal(provider?.env?.CLOUDFLARE_ACCOUNT_ID, "account-id");
    assert.equal(provider?.credential?.type, "api_key");
    assert.equal(provider?.baseUrl, profile.baseUrl);
  });

  it("deduplicates replayed sandbox events", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-manager-events-"));
    try {
      const ingestor = new SandboxEventIngestor(new EventStore(dir));
      assert.equal(
        (
          await ingestor.ingestBatch("sbx_1", [
            { id: "evt_1", seq: 1, type: "run.started" },
          ])
        ).accepted,
        1,
      );
      assert.equal(
        (
          await ingestor.ingestBatch("sbx_1", [
            { id: "evt_1", seq: 1, type: "run.started" },
          ])
        ).accepted,
        0,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
