import type { SandboxManagerCredentialProfileWrite } from "@nervekit/shared";
import type { ProviderOption } from "./provider-catalog";

export type CredentialProfileFormValues = {
  displayName: string;
  secretValue: string;
  siteUrl: string;
  email: string;
  defaultModel: string;
  api: string;
  baseUrl: string;
  envJson: string;
  headersJson: string;
  compatJson: string;
  providerOptionsJson: string;
  defaultOwner: string;
  defaultRepo: string;
  defaultProjectKey: string;
  defaultSpaceKey: string;
  githubAppId: string;
  githubInstallationId: string;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  knownHosts?: string;
};

export function parseJsonObject<T extends Record<string, unknown>>(
  raw: string,
  label: string,
): T | undefined {
  if (!raw.trim()) return undefined;
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object`);
  return parsed as T;
}

export function parseStringRecord(
  raw: string,
  label: string,
): Record<string, string> | undefined {
  const parsed = parseJsonObject<Record<string, unknown>>(raw, label);
  if (!parsed) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string")
      throw new Error(`${label} value for ${key} must be a string`);
    result[key] = value;
  }
  return result;
}

export function buildCredentialProfileWrite(
  option: ProviderOption,
  values: CredentialProfileFormValues,
): SandboxManagerCredentialProfileWrite {
  const request: SandboxManagerCredentialProfileWrite = {
    kind: option.kind,
    providerKind: option.providerKind,
    displayName: values.displayName.trim() || option.label,
    provider: option.provider,
    api: values.api.trim() || undefined,
    baseUrl: values.baseUrl.trim() || undefined,
    siteUrl: values.siteUrl.trim() || undefined,
    email: values.email.trim() || undefined,
    headers: parseStringRecord(values.headersJson, "Headers"),
    compat: parseJsonObject(values.compatJson, "Compatibility"),
    providerOptions: parseJsonObject(
      values.providerOptionsJson,
      "Provider options",
    ),
    env: parseStringRecord(values.envJson, "Provider env"),
    gitAuthorName:
      values.gitAuthorName?.trim() ||
      (option.providerKind === "git_identity" ? values.displayName.trim() : undefined),
    gitAuthorEmail:
      values.gitAuthorEmail?.trim() ||
      (option.providerKind === "git_identity" ? values.email.trim() : undefined),
    defaultModel: values.defaultModel.trim() || undefined,
    defaultOwner: values.defaultOwner.trim() || undefined,
    defaultRepo: values.defaultRepo.trim() || undefined,
    defaultProjectKey: values.defaultProjectKey.trim() || undefined,
    defaultSpaceKey: values.defaultSpaceKey.trim() || undefined,
  };
  if (option.secretMode === "none") return request;
  if (option.secretMode === "oauth")
    request.oauthImport = parseJsonObject(values.secretValue, "OAuth bundle");
  else if (option.secretMode === "githubApp") {
    request.githubApp = {
      appId: values.githubAppId.trim(),
      installationId: values.githubInstallationId.trim(),
      privateKey: values.secretValue,
    };
  } else if (option.secretMode === "privateKey") {
    request.privateKey = values.secretValue;
    request.knownHosts = values.knownHosts?.trim() || undefined;
  } else request.apiKey = values.secretValue;
  return request;
}
