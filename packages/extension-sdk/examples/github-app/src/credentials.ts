import {
  defineCredentialProvider,
  ExtensionError,
  type CredentialCrypto,
  type CredentialHttp,
  type CredentialAccount,
} from "@nervekit/extension-sdk";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Base64url without padding; the sandbox has no Buffer. */
export function base64Url(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += ALPHABET[a >> 2]! + ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) out += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) out += ALPHABET[c & 63]!;
  }
  return out;
}

const text = (value: string) => new TextEncoder().encode(value);

/** The JWT a GitHub App authenticates with: valid ten minutes, backdated a minute for clock drift. */
export async function appJwt(
  appId: string,
  privateKey: string,
  crypto: CredentialCrypto,
  now = Date.now(),
): Promise<string> {
  const seconds = Math.floor(now / 1000);
  const signingInput = `${base64Url(text(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${base64Url(text(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: appId })))}`;
  const signature = await crypto.sign({
    algorithm: "RS256",
    privateKey,
    data: signingInput,
  });
  return `${signingInput}.${base64Url(signature)}`;
}

/** Exchanges the app's JWT for an installation token. */
async function installationToken(input: {
  account: CredentialAccount;
  secrets: Record<string, string>;
  crypto: CredentialCrypto;
  http: CredentialHttp;
}) {
  const { account, secrets, crypto, http } = input;
  const appId = String(account.fields.appId ?? "");
  const installation = String(account.fields.installationId ?? "");
  if (!appId || !installation || !secrets.privateKey)
    throw new ExtensionError(
      "BAD_REQUEST",
      "Enter the app id, the installation id and the private key.",
    );
  const jwt = await appJwt(appId, secrets.privateKey, crypto);
  const response = await http.request({
    url: `https://api.github.com/app/installations/${encodeURIComponent(installation)}/access_tokens`,
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/vnd.github+json",
      "user-agent": "nerve-github-app-example",
    },
  });
  const body = response.body as { token?: string; expires_at?: string };
  if (!response.ok || !body?.token)
    throw new ExtensionError(
      response.status >= 500 ? "SERVER_ERROR" : "UNAUTHORIZED",
      `GitHub did not issue an installation token (HTTP ${response.status}).`,
    );
  return {
    state: { token: body.token },
    ...(body.expires_at ? { expiresAt: body.expires_at } : {}),
    identity: { installationId: installation },
  };
}

export default defineCredentialProvider({
  signIn: (ctx) => installationToken(ctx),

  // A rejected key or installation needs a new sign-in; a failure to reach GitHub throws and is retried.
  async refresh(ctx) {
    try {
      return await installationToken(ctx);
    } catch (error) {
      if (error instanceof ExtensionError && error.code === "UNAUTHORIZED")
        return { needsSignIn: true, message: error.message };
      throw error;
    }
  },

  apply: ({ state }) => ({
    headers: { authorization: `Bearer ${(state as { token: string }).token}` },
  }),
});
