import { createHash, randomBytes } from "node:crypto";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/oauth";

const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d5-88ed-5944d1962f5e";
const ANTHROPIC_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const ANTHROPIC_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const ANTHROPIC_REDIRECT_URI = "http://localhost:53692/callback";
const ANTHROPIC_SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
const OPENAI_CODEX_SCOPE = "openid profile email offline_access";
const OPENAI_CODEX_JWT_CLAIM_PATH = "https://api.openai.com/auth";

export async function loginWithManualRedirect(
  providerId: string,
  callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials | undefined> {
  if (providerId === "anthropic") return loginAnthropicManual(callbacks);
  if (providerId === "openai-codex") return loginOpenAICodexManual(callbacks);
  return undefined;
}

async function loginAnthropicManual(
  callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
  const { verifier, challenge } = generatePkce();
  const authParams = new URLSearchParams({
    code: "true",
    client_id: ANTHROPIC_CLIENT_ID,
    response_type: "code",
    redirect_uri: ANTHROPIC_REDIRECT_URI,
    scope: ANTHROPIC_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier,
  });
  callbacks.onAuth({
    url: `${ANTHROPIC_AUTHORIZE_URL}?${authParams.toString()}`,
    instructions:
      "Sign in, then copy the final redirect URL from the browser address bar and paste it here.",
  });
  const input = await callbacks.onManualCodeInput?.();
  const parsed = parseAuthorizationInput(input ?? "");
  if (parsed.state && parsed.state !== verifier) throw new Error("OAuth state mismatch");
  if (!parsed.code) throw new Error("Missing authorization code");
  callbacks.onProgress?.("Exchanging authorization code for tokens...");
  const tokenData = await postJson<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  }>(ANTHROPIC_TOKEN_URL, {
    grant_type: "authorization_code",
    client_id: ANTHROPIC_CLIENT_ID,
    code: parsed.code,
    state: parsed.state ?? verifier,
    redirect_uri: ANTHROPIC_REDIRECT_URI,
    code_verifier: verifier,
  });
  if (!tokenData.access_token || !tokenData.refresh_token || !tokenData.expires_in)
    throw new Error("Anthropic token response missing fields");
  return {
    access: tokenData.access_token,
    refresh: tokenData.refresh_token,
    expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
  };
}

async function loginOpenAICodexManual(
  callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(16).toString("hex");
  const url = new URL(OPENAI_CODEX_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OPENAI_CODEX_CLIENT_ID);
  url.searchParams.set("redirect_uri", OPENAI_CODEX_REDIRECT_URI);
  url.searchParams.set("scope", OPENAI_CODEX_SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "pi");

  callbacks.onAuth({
    url: url.toString(),
    instructions:
      "Sign in, then copy the final redirect URL from the browser address bar and paste it here.",
  });
  const input = await callbacks.onManualCodeInput?.();
  const parsed = parseAuthorizationInput(input ?? "");
  if (parsed.state && parsed.state !== state) throw new Error("State mismatch");
  if (!parsed.code) throw new Error("Missing authorization code");
  callbacks.onProgress?.("Exchanging authorization code for tokens...");

  const tokenData = await postForm<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  }>(OPENAI_CODEX_TOKEN_URL, {
    grant_type: "authorization_code",
    client_id: OPENAI_CODEX_CLIENT_ID,
    code: parsed.code,
    code_verifier: verifier,
    redirect_uri: OPENAI_CODEX_REDIRECT_URI,
  });
  if (!tokenData.access_token || !tokenData.refresh_token || !tokenData.expires_in)
    throw new Error("OpenAI Codex token response missing fields");
  const accountId = getOpenAICodexAccountId(tokenData.access_token);
  if (!accountId) throw new Error("Failed to extract accountId from token");
  return {
    access: tokenData.access_token,
    refresh: tokenData.refresh_token,
    expires: Date.now() + tokenData.expires_in * 1000,
    accountId,
  };
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function parseAuthorizationInput(input: string): {
  code?: string;
  state?: string;
} {
  const value = input.trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    // Not a URL.
  }
  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }
  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
    };
  }
  return { code: value };
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return readJsonResponse<T>(response, url);
}

async function postForm<T>(url: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(30_000),
  });
  return readJsonResponse<T>(response, url);
}

async function readJsonResponse<T>(response: Response, url: string): Promise<T> {
  const responseBody = await response.text();
  if (!response.ok)
    throw new Error(
      `OAuth token request failed. status=${response.status}; url=${url}; body=${responseBody}`,
    );
  return JSON.parse(responseBody) as T;
}

function getOpenAICodexAccountId(accessToken: string): string | undefined {
  const payload = decodeJwt(accessToken) as
    | Record<string, Record<string, unknown> | undefined>
    | undefined;
  const auth = payload?.[OPENAI_CODEX_JWT_CLAIM_PATH];
  const accountId = auth?.chatgpt_account_id;
  return typeof accountId === "string" && accountId.length > 0
    ? accountId
    : undefined;
}

function decodeJwt(token: string): unknown {
  try {
    const [, payload] = token.split(".");
    if (!payload) return undefined;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}
