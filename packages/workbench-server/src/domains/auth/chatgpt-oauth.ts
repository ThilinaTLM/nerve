export function chatGptAccountIdFromAccessToken(
  accessToken: string,
): string | undefined {
  const payload = accessToken.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      "https://api.openai.com/auth"?: { chatgpt_account_id?: unknown };
    };
    const accountId = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof accountId === "string" && accountId ? accountId : undefined;
  } catch {
    return undefined;
  }
}
