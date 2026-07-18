import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type {
  ManagedContainerCreateSpec,
  SandboxManagerCredentialProfile,
} from "@nervekit/contracts";
import { applyCredentialProfiles } from "../src/config/apply-credential-profiles.js";
import { containerCreateArgs } from "../src/drivers/container-args.js";
import { validateManagedContainerCreateSpec } from "../src/drivers/validation.js";
import { SandboxEventIngestor } from "../src/events/sandbox-event-ingestor.js";
import { EventStore } from "../src/state/event-store.js";

function spec(): ManagedContainerCreateSpec {
  return {
    backend: "docker",
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
          defaultModel: {
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

  it("archives a cursor-ahead manager epoch and re-ingests a fresh agent from seq 1", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-manager-epoch-"));
    try {
      const store = new EventStore(dir);
      await store.appendBatch([
        {
          sandboxId: "sbx_epoch",
          id: "evt_old_1",
          seq: 1,
          type: "old.event",
          ts: "2026-01-01T00:00:00.000Z",
          payload: {},
        },
        {
          sandboxId: "sbx_epoch",
          id: "evt_old_2",
          seq: 2,
          type: "old.event",
          ts: "2026-01-01T00:00:01.000Z",
          payload: {},
        },
      ]);
      const ingestor = new SandboxEventIngestor(store);

      const established = await ingestor.establishAgentEpoch("sbx_epoch", 0);
      assert.deepEqual(established, {
        reset: true,
        previousLatestSeq: 2,
        latestSeq: 0,
        earliestAvailableSeq: 1,
      });
      assert.deepEqual(await store.list("sbx_epoch"), []);
      const archiveFiles = await readdir(path.join(dir, "archive", "epochs"));
      assert.equal(archiveFiles.length, 1);
      const archived = JSON.parse(
        await readFile(
          path.join(dir, "archive", "epochs", archiveFiles[0]!),
          "utf8",
        ),
      ) as Array<{ id: string }>;
      assert.deepEqual(
        archived.map((event) => event.id),
        ["evt_old_1", "evt_old_2"],
      );

      const fresh = await ingestor.ingestBatch("sbx_epoch", [
        {
          id: "evt_fresh_1",
          seq: 1,
          type: "run.started",
          ts: "2026-01-02T00:00:00.000Z",
          data: {
            conversationId: "conv_fresh",
            agentId: "agent_fresh",
            projectId: "proj_fresh",
            runId: "run_fresh",
            startedAt: "2026-01-02T00:00:00.000Z",
          },
        },
      ]);
      assert.equal(fresh.processedSeq, 1);
      assert.deepEqual(
        (await store.list("sbx_epoch")).map((event) => event.id),
        ["evt_fresh_1"],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps sequenced ingestion dense while notify bypasses the cursor", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-manager-chain-"));
    try {
      const ingestor = new SandboxEventIngestor(new EventStore(dir));
      const first = await ingestor.ingestBatch("sbx_chain", [
        {
          id: "evt_chain_1",
          seq: 1,
          type: "run.started",
          ts: "2026-01-01T00:00:00.000Z",
          data: {
            conversationId: "conv_1",
            agentId: "agent_1",
            projectId: "proj_1",
            runId: "run_1",
            startedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      ]);
      assert.equal(first.processedSeq, 1);
      ingestor.ingestNotify("sbx_chain", [
        {
          id: "evt_chain_notify",
          type: "run.delta",
          ts: "2026-01-01T00:00:30.000Z",
          data: {
            conversationId: "conv_1",
            agentId: "agent_1",
            runId: "run_1",
            deltaId: "delta_1",
            role: "assistant",
            text: "working",
          },
        },
      ]);
      const second = await ingestor.ingestBatch("sbx_chain", [
        {
          id: "evt_chain_2",
          seq: 2,
          type: "run.completed",
          ts: "2026-01-01T00:01:00.000Z",
          data: {
            conversationId: "conv_1",
            agentId: "agent_1",
            projectId: "proj_1",
            runId: "run_1",
            completedAt: "2026-01-01T00:01:00.000Z",
            status: "completed",
          },
        },
      ]);
      assert.equal(second.processedSeq, 2);
      await assert.rejects(
        ingestor.ingestBatch("sbx_chain", [
          {
            id: "evt_chain_4",
            seq: 4,
            type: "run.completed",
            ts: "2026-01-01T00:02:00.000Z",
            data: {
              conversationId: "conv_1",
              agentId: "agent_1",
              projectId: "proj_1",
              runId: "run_1",
              completedAt: "2026-01-01T00:02:00.000Z",
              status: "completed",
            },
          },
        ]),
        /expected 3, received 4/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("deduplicates replayed sandbox events", async () => {
    const startedAt = new Date().toISOString();
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-manager-events-"));
    try {
      const ingestor = new SandboxEventIngestor(new EventStore(dir));
      assert.equal(
        (
          await ingestor.ingestBatch("sbx_1", [
            {
              id: "evt_1",
              seq: 1,
              type: "run.started",
              ts: startedAt,
              data: {
                conversationId: "conv_1",
                agentId: "agent_1",
                projectId: "proj_1",
                runId: "run_1",
                startedAt,
              },
            },
          ])
        ).accepted,
        1,
      );
      assert.equal(
        (
          await ingestor.ingestBatch("sbx_1", [
            {
              id: "evt_1",
              seq: 1,
              type: "run.started",
              ts: startedAt,
              data: {
                conversationId: "conv_1",
                agentId: "agent_1",
                projectId: "proj_1",
                runId: "run_1",
                startedAt,
              },
            },
          ])
        ).accepted,
        0,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
