import type {
  AuthProviderMetadata,
  CredentialKeyResponse,
  EncryptedSecretEnvelope,
  OAuthFlowInfo,
  RespondOAuthFlowRequest,
} from "@nervekit/shared";
import {
  apiDelete,
  apiGet,
  apiPathSegment,
  apiPost,
  apiPut,
} from "../../../core/api/client";
import { protocolRequest } from "../../../core/protocol/http-client";

export async function getAuthProviders(): Promise<AuthProviderMetadata[]> {
  return (
    await protocolRequest<{ providers: AuthProviderMetadata[] }>(
      "auth.providers.list",
      {},
    )
  ).result.providers;
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
