import {
  type ManagedSandboxListItem,
  type ManagedSandboxRecord,
  type ModelInfo,
  managedSandboxListItemSchema,
  managedSandboxRecordSchema,
  modelInfoSchema,
  type OAuthFlowInfo,
  oauthFlowInfoSchema,
  type RespondOAuthFlowRequest,
  type SandboxConfigYamlResult,
  type SandboxControllerSessionSummary,
  type SandboxCreateRequest,
  type SandboxManagerCredentialProfile,
  type SandboxManagerCredentialProfileWrite,
  type SandboxManagerSecretMetadata,
  type SandboxManagerStatus,
  type SandboxSnapshotResult,
  type SandboxStatusGetResult,
  type SandboxWorkspaceFileResponse,
  sandboxConfigYamlResultSchema,
  sandboxManagerCredentialProfileSchema,
  sandboxManagerSecretMetadataSchema,
  sandboxManagerStatusSchema,
  sandboxSnapshotResultSchema,
  sandboxStatusGetResultSchema,
  sandboxWorkspaceFileResponseSchema,
} from "@nervekit/shared";
import { apiPathSegment, fetchJson } from "@nervekit/shared-ui/core/api/client";
import type {
  ManagerEnvelope,
  RemoveOptions,
  SandboxLogsQuery,
  SandboxLogsResult,
  SandboxSnapshotQuery,
} from "./types";

async function getData<T>(path: string): Promise<T> {
  const body = await fetchJson<ManagerEnvelope<T>>(path);
  return body.data;
}

async function sendData<T>(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  options: { body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.idempotencyKey)
    headers["idempotency-key"] = options.idempotencyKey;
  const body = await fetchJson<ManagerEnvelope<T>>(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return body.data;
}

function sandboxPath(sandboxId: string, suffix = ""): string {
  return `/api/sandboxes/${apiPathSegment(sandboxId)}${suffix}`;
}
export async function getManagerStatus(): Promise<SandboxManagerStatus> {
  return sandboxManagerStatusSchema.parse(
    await getData<unknown>("/api/manager/status"),
  );
}

export async function listAuthProviders(): Promise<unknown[]> {
  return getData<unknown[]>("/api/manager/auth/providers");
}

export async function listModels(): Promise<ModelInfo[]> {
  const records = await getData<unknown[]>("/api/manager/models");
  return records.map((record) => modelInfoSchema.parse(record));
}

export async function startOAuthFlow(request: {
  provider: string;
  profileId?: string;
  displayName?: string;
  defaultModel?: string;
}): Promise<OAuthFlowInfo> {
  return oauthFlowInfoSchema.parse(
    await sendData<unknown>("/api/manager/auth/oauth/start", "POST", {
      body: request,
    }),
  );
}

export async function getOAuthFlow(flowId: string): Promise<OAuthFlowInfo> {
  return oauthFlowInfoSchema.parse(
    await getData<unknown>(`/api/manager/auth/oauth/${apiPathSegment(flowId)}`),
  );
}

export async function respondOAuthFlow(
  flowId: string,
  request: RespondOAuthFlowRequest,
): Promise<OAuthFlowInfo> {
  return oauthFlowInfoSchema.parse(
    await sendData<unknown>(
      `/api/manager/auth/oauth/${apiPathSegment(flowId)}/respond`,
      "POST",
      { body: request },
    ),
  );
}

export async function cancelOAuthFlow(flowId: string): Promise<OAuthFlowInfo> {
  return oauthFlowInfoSchema.parse(
    await sendData<unknown>(
      `/api/manager/auth/oauth/${apiPathSegment(flowId)}/cancel`,
      "POST",
    ),
  );
}

export async function refreshCredentialProfile(
  profileId: string,
): Promise<unknown> {
  return sendData<unknown>(
    `/api/manager/credential-profiles/${apiPathSegment(profileId)}/refresh`,
    "POST",
  );
}

export async function listCredentialProfiles(): Promise<
  SandboxManagerCredentialProfile[]
> {
  const records = await getData<unknown[]>("/api/manager/credential-profiles");
  return records.map((record) =>
    sandboxManagerCredentialProfileSchema.parse(record),
  );
}

export async function createCredentialProfile(
  request: SandboxManagerCredentialProfileWrite,
): Promise<SandboxManagerCredentialProfile> {
  return sandboxManagerCredentialProfileSchema.parse(
    await sendData<unknown>("/api/manager/credential-profiles", "POST", {
      body: request,
    }),
  );
}

export async function updateCredentialProfile(
  profileId: string,
  request: SandboxManagerCredentialProfileWrite,
): Promise<SandboxManagerCredentialProfile> {
  return sandboxManagerCredentialProfileSchema.parse(
    await sendData<unknown>(
      `/api/manager/credential-profiles/${apiPathSegment(profileId)}`,
      "PUT",
      { body: request },
    ),
  );
}

export async function listSecretMetadata(): Promise<
  SandboxManagerSecretMetadata[]
> {
  const records = await getData<unknown[]>("/api/manager/secrets/metadata");
  return records.map((record) =>
    sandboxManagerSecretMetadataSchema.parse(record),
  );
}

export async function writeManagerSecret(request: {
  key: string;
  value: string;
  version?: string;
  expiresAt?: string;
}): Promise<{ key: string; version?: string }> {
  return sendData<{ key: string; version?: string }>(
    "/api/manager/secrets",
    "POST",
    { body: request },
  );
}

export async function listSandboxes(): Promise<ManagedSandboxListItem[]> {
  const records = await getData<unknown[]>("/api/sandboxes");
  return records.map((record) => managedSandboxListItemSchema.parse(record));
}

export async function getSandboxRecord(
  sandboxId: string,
): Promise<ManagedSandboxRecord | undefined> {
  const record = await getData<unknown>(sandboxPath(sandboxId));
  return record ? managedSandboxRecordSchema.parse(record) : undefined;
}

export async function createSandbox(
  request: SandboxCreateRequest,
  idempotencyKey: string,
): Promise<ManagedSandboxRecord> {
  return managedSandboxRecordSchema.parse(
    await sendData<unknown>("/api/sandboxes", "POST", {
      body: request,
      idempotencyKey,
    }),
  );
}

export async function previewSandboxConfigYaml(
  request: SandboxCreateRequest,
): Promise<SandboxConfigYamlResult> {
  return sandboxConfigYamlResultSchema.parse(
    await sendData<unknown>("/api/sandboxes/config/preview", "POST", {
      body: request,
    }),
  );
}

export async function getSandboxConfigYaml(
  sandboxId: string,
): Promise<SandboxConfigYamlResult> {
  return sandboxConfigYamlResultSchema.parse(
    await getData<unknown>(sandboxPath(sandboxId, "/config")),
  );
}

export async function startSandbox(
  sandboxId: string,
  idempotencyKey: string,
): Promise<ManagedSandboxRecord> {
  return managedSandboxRecordSchema.parse(
    await sendData<unknown>(sandboxPath(sandboxId, "/start"), "POST", {
      body: {},
      idempotencyKey,
    }),
  );
}

export async function stopSandbox(
  sandboxId: string,
  idempotencyKey: string,
): Promise<ManagedSandboxRecord> {
  return managedSandboxRecordSchema.parse(
    await sendData<unknown>(sandboxPath(sandboxId, "/stop"), "POST", {
      body: {},
      idempotencyKey,
    }),
  );
}

export async function restartSandbox(
  sandboxId: string,
  idempotencyKey: string,
): Promise<ManagedSandboxRecord> {
  return managedSandboxRecordSchema.parse(
    await sendData<unknown>(sandboxPath(sandboxId, "/restart"), "POST", {
      body: {},
      idempotencyKey,
    }),
  );
}

export async function removeSandbox(
  sandboxId: string,
  options: RemoveOptions,
  idempotencyKey: string,
): Promise<ManagedSandboxRecord> {
  const params = new URLSearchParams();
  if (options.force) params.set("force", "1");
  if (options.removeVolumes) params.set("removeVolumes", "1");
  const query = params.toString();
  return managedSandboxRecordSchema.parse(
    await sendData<unknown>(
      `${sandboxPath(sandboxId)}${query ? `?${query}` : ""}`,
      "DELETE",
      { idempotencyKey },
    ),
  );
}

export async function getSandboxStatus(
  sandboxId: string,
): Promise<SandboxStatusGetResult> {
  return sandboxStatusGetResultSchema.parse(
    await getData<unknown>(sandboxPath(sandboxId, "/status")),
  );
}

export async function getSandboxSnapshot(
  sandboxId: string,
  params?: SandboxSnapshotQuery,
): Promise<SandboxSnapshotResult> {
  const search = new URLSearchParams();
  if (params?.conversationId)
    search.set("conversationId", params.conversationId);
  if (params?.agentId) search.set("agentId", params.agentId);
  if (params?.runId) search.set("runId", params.runId);
  const query = search.toString();
  return sandboxSnapshotResultSchema.parse(
    await getData<unknown>(
      sandboxPath(sandboxId, `/snapshot${query ? `?${query}` : ""}`),
    ),
  );
}

export async function getSandboxLogs(
  sandboxId: string,
  query: SandboxLogsQuery = {},
): Promise<SandboxLogsResult> {
  const search = new URLSearchParams();
  if (query.tail !== undefined) search.set("tail", String(query.tail));
  if (query.since) search.set("since", query.since);
  if (query.maxBytes !== undefined)
    search.set("maxBytes", String(query.maxBytes));
  const suffix = search.toString();
  return getData<SandboxLogsResult>(
    sandboxPath(sandboxId, `/logs${suffix ? `?${suffix}` : ""}`),
  );
}

export async function getSandboxWorkspaceFile(
  sandboxId: string,
  path: string,
  line?: number,
): Promise<SandboxWorkspaceFileResponse> {
  const search = new URLSearchParams({ path });
  if (line !== undefined) search.set("line", String(line));
  return sandboxWorkspaceFileResponseSchema.parse(
    await getData<unknown>(
      sandboxPath(sandboxId, `/workspace/file?${search.toString()}`),
    ),
  );
}

export async function getSandboxEvents(sandboxId: string): Promise<unknown[]> {
  return getData<unknown[]>(sandboxPath(sandboxId, "/events"));
}

export async function getLatestSession(
  sandboxId: string,
): Promise<SandboxControllerSessionSummary | undefined> {
  return getData<SandboxControllerSessionSummary | undefined>(
    sandboxPath(sandboxId, "/sessions/latest"),
  );
}

export async function sendSandboxCommand(
  sandboxId: string,
  method: string,
  params: unknown,
  idempotencyKey: string,
): Promise<unknown> {
  return sendData<unknown>(sandboxPath(sandboxId, "/commands"), "POST", {
    body: { method, params, idempotencyKey },
    idempotencyKey,
  });
}
