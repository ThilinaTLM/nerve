import type { AccountView } from "@nervekit/contracts/settings";
import type {
  AccountHealth,
  AccountRef,
  AuthProviderMetadata,
  CredentialKeyResponse,
  EncryptedSecretEnvelope,
  OAuthFlowInfo,
  RespondOAuthFlowRequest,
  SaveAccountRequest,
} from "@nervekit/contracts/auth";
import {
  apiDelete,
  apiGet,
  apiPathSegment,
  apiPost,
  apiPut,
} from "$lib/platform/http/api-client";
import { protocolRequest } from "$lib/application/startup/workbench-connection";

export async function getAuthProviders(): Promise<AuthProviderMetadata[]> {
  return (await protocolRequest("auth.providers.list", {})).result.providers;
}

export async function getCredentialKey(): Promise<CredentialKeyResponse> {
  return apiGet<CredentialKeyResponse>("/api/auth/credential-key");
}

export async function setProviderApiKey(
  provider: string,
  encryptedApiKey: EncryptedSecretEnvelope,
): Promise<void> {
  await apiPut<{ ok: boolean }>("/api/provider-keys", {
    provider,
    encryptedApiKey,
  });
}

export async function deleteProviderCredential(
  provider: string,
): Promise<void> {
  await apiDelete<{ ok: boolean }>(
    `/api/auth/providers/${apiPathSegment(provider)}`,
  );
}

export async function startOAuthFlow(provider: string): Promise<OAuthFlowInfo> {
  return (
    await apiPost<{ flow: OAuthFlowInfo }>("/api/auth/oauth/flows", {
      provider,
    })
  ).flow;
}

export async function getOAuthFlow(flowId: string): Promise<OAuthFlowInfo> {
  return (
    await apiGet<{ flow: OAuthFlowInfo }>(
      `/api/auth/oauth/flows/${apiPathSegment(flowId)}`,
    )
  ).flow;
}

export async function respondOAuthFlow(
  flowId: string,
  body: RespondOAuthFlowRequest,
): Promise<OAuthFlowInfo> {
  return (
    await apiPost<{ flow: OAuthFlowInfo }>(
      `/api/auth/oauth/flows/${apiPathSegment(flowId)}/respond`,
      body,
    )
  ).flow;
}

export async function cancelOAuthFlow(flowId: string): Promise<OAuthFlowInfo> {
  return (
    await apiPost<{ flow: OAuthFlowInfo }>(
      `/api/auth/oauth/flows/${apiPathSegment(flowId)}/cancel`,
      {},
    )
  ).flow;
}

export async function listAccounts() {
  return (await protocolRequest("accounts.list", {})).result;
}

export async function saveAccount(
  request: SaveAccountRequest,
): Promise<AccountView> {
  return (
    await protocolRequest("accounts.save", request, {
      idempotencyKey: crypto.randomUUID(),
    })
  ).result.account;
}

export async function deleteAccount(ref: AccountRef): Promise<void> {
  await protocolRequest("accounts.delete", ref, {
    idempotencyKey: crypto.randomUUID(),
  });
}

export async function listAccountHealth(): Promise<AccountHealth[]> {
  return (await protocolRequest("accounts.health.list", {})).result.health;
}

export async function testAccount(ref: AccountRef): Promise<AccountHealth> {
  return (
    await protocolRequest("accounts.test", ref, {
      idempotencyKey: crypto.randomUUID(),
    })
  ).result.health;
}
