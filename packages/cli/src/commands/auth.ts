import type { AuthProviderMetadata, OAuthFlowInfo } from "@nervekit/shared";
import { apiDelete, apiGet, apiPost, apiPut } from "../daemon/http-client.js";
import {
  delay,
  readLinePrompt,
  readSecretPrompt,
  readStdin,
} from "../output/prompts.js";

type AuthProvidersResponse = { providers: AuthProviderMetadata[] };

function printAuthHelp(): void {
  console.log(`nerve auth

Usage:
  nerve auth list
  nerve auth login <provider>
  nerve auth set-key <provider> [--stdin]
  nerve auth remove <provider>
`);
}

function providerLabel(provider: AuthProviderMetadata): string {
  const credential = provider.credentialType ?? "not configured";
  return `${provider.displayName} (${provider.provider}) · ${credential}`;
}

async function commandAuthList(): Promise<void> {
  const { providers } = await apiGet<AuthProvidersResponse>(
    "/api/auth/providers",
  );
  const configured = providers.filter((provider) => provider.configured);
  const oauthAvailable = providers.filter(
    (provider) => provider.supportsOAuth && !provider.configured,
  );
  const apiKeyAvailable = providers.filter(
    (provider) => provider.supportsApiKey && !provider.configured,
  );

  console.log("Configured providers:");
  if (configured.length === 0) {
    console.log("  none");
  } else {
    for (const provider of configured) {
      console.log(`  ${providerLabel(provider)}`);
      if (provider.warning) console.log(`    warning: ${provider.warning}`);
    }
  }

  if (oauthAvailable.length > 0) {
    console.log("\nSubscription/OAuth providers:");
    for (const provider of oauthAvailable) {
      console.log(
        `  ${provider.displayName} (${provider.provider}) — nerve auth login ${provider.provider}`,
      );
    }
  }

  if (apiKeyAvailable.length > 0) {
    console.log("\nAPI-key providers:");
    for (const provider of apiKeyAvailable) {
      const env = provider.envVar ? `, env ${provider.envVar}` : "";
      console.log(
        `  ${provider.provider}${env} — nerve auth set-key ${provider.provider}`,
      );
    }
  }
}

function isTerminalOAuthFlow(flow: OAuthFlowInfo): boolean {
  return ["succeeded", "failed", "cancelled"].includes(flow.status);
}

async function chooseOAuthOption(flow: OAuthFlowInfo): Promise<string> {
  if (!flow.options?.length) throw new Error("OAuth flow has no options.");
  console.log(flow.message ?? "Choose an option:");
  flow.options.forEach((option, index) => {
    console.log(`  ${index + 1}. ${option.label} (${option.id})`);
  });

  while (true) {
    const answer = (await readLinePrompt("Selection: ")).trim();
    const byNumber = Number(answer);
    if (
      Number.isInteger(byNumber) &&
      byNumber >= 1 &&
      byNumber <= flow.options.length
    ) {
      return flow.options[byNumber - 1].id;
    }
    const byId = flow.options.find((option) => option.id === answer);
    if (byId) return byId.id;
    console.log("Enter an option number or id.");
  }
}

async function promptOAuthValue(flow: OAuthFlowInfo): Promise<string> {
  const label = `${flow.message ?? "Response"} `;
  while (true) {
    const value = await readLinePrompt(label);
    if (flow.allowEmpty || value.trim().length > 0) return value;
    console.log("A response is required.");
  }
}

async function getOAuthFlow(flowId: string): Promise<OAuthFlowInfo> {
  return (
    await apiGet<{ flow: OAuthFlowInfo }>(
      `/api/auth/oauth/flows/${encodeURIComponent(flowId)}`,
    )
  ).flow;
}

async function waitForOAuthFlowAdvance(
  previous: OAuthFlowInfo,
): Promise<OAuthFlowInfo> {
  for (let attempt = 0; attempt < 60; attempt++) {
    await delay(attempt === 0 ? 100 : 500);
    const next = await getOAuthFlow(previous.flowId);
    if (
      next.status !== previous.status ||
      next.promptId !== previous.promptId ||
      next.updatedAt !== previous.updatedAt ||
      isTerminalOAuthFlow(next)
    ) {
      return next;
    }
  }
  throw new Error("OAuth flow did not advance after submitting a response.");
}

async function driveOAuthFlow(initialFlow: OAuthFlowInfo): Promise<void> {
  let flow = initialFlow;
  const printed = new Set<string>();

  const printOnce = (key: string, print: () => void) => {
    if (printed.has(key)) return;
    printed.add(key);
    print();
  };

  while (true) {
    if (flow.status === "succeeded") {
      console.log(flow.message ?? `Logged in to ${flow.providerName}.`);
      return;
    }
    if (flow.status === "failed") {
      throw new Error(flow.message ?? flow.error ?? "OAuth login failed.");
    }
    if (flow.status === "cancelled") {
      throw new Error(flow.message ?? "OAuth login cancelled.");
    }

    if (flow.status === "auth_url") {
      printOnce(`auth:${flow.authUrl ?? ""}:${flow.instructions ?? ""}`, () => {
        console.log(flow.message ?? "Complete login in your browser.");
        if (flow.authUrl) console.log(`Open: ${flow.authUrl}`);
        if (flow.instructions) console.log(flow.instructions);
      });
    } else if (flow.status === "device_code" && flow.deviceCode) {
      printOnce(
        `device:${flow.deviceCode.verificationUri}:${flow.deviceCode.userCode}`,
        () => {
          console.log(flow.message ?? "Complete login with the device code.");
          console.log(`Open: ${flow.deviceCode?.verificationUri}`);
          console.log(`Code: ${flow.deviceCode?.userCode}`);
        },
      );
    } else if (flow.status === "select" && flow.promptId) {
      const selectedId = await chooseOAuthOption(flow);
      await apiPost<{ flow: OAuthFlowInfo }>(
        `/api/auth/oauth/flows/${encodeURIComponent(flow.flowId)}/respond`,
        { promptId: flow.promptId, selectedId },
      );
      flow = await waitForOAuthFlowAdvance(flow);
      continue;
    } else if (flow.status === "prompt" && flow.promptId) {
      printOnce(
        `prompt-auth:${flow.authUrl ?? ""}:${flow.instructions ?? ""}`,
        () => {
          if (flow.authUrl) console.log(`Open: ${flow.authUrl}`);
          if (flow.instructions) console.log(flow.instructions);
        },
      );
      const value = await promptOAuthValue(flow);
      await apiPost<{ flow: OAuthFlowInfo }>(
        `/api/auth/oauth/flows/${encodeURIComponent(flow.flowId)}/respond`,
        { promptId: flow.promptId, value },
      );
      flow = await waitForOAuthFlowAdvance(flow);
      continue;
    } else if (flow.status === "progress" && flow.message) {
      printOnce(`progress:${flow.message}`, () => console.log(flow.message));
    }

    if (!isTerminalOAuthFlow(flow)) await delay(1000);
    flow = await getOAuthFlow(flow.flowId);
  }
}

async function commandAuthLogin(args: string[]): Promise<void> {
  const provider = args.find((arg) => !arg.startsWith("-"));
  if (!provider) throw new Error("Usage: nerve auth login <provider>");
  const { flow } = await apiPost<{ flow: OAuthFlowInfo }>(
    "/api/auth/oauth/flows",
    { provider },
  );
  await driveOAuthFlow(flow);
}

async function commandAuthSetKey(args: string[]): Promise<void> {
  const provider = args.find((arg) => !arg.startsWith("-"));
  if (!provider)
    throw new Error("Usage: nerve auth set-key <provider> [--stdin]");
  const apiKey = (
    args.includes("--stdin")
      ? await readStdin()
      : await readSecretPrompt(`API key for ${provider}: `)
  ).trim();
  if (!apiKey) throw new Error("API key cannot be empty.");
  await apiPut<{ ok: true }>("/api/provider-keys", { provider, apiKey });
  console.log(`Saved API key for ${provider}.`);
}

async function commandAuthRemove(args: string[]): Promise<void> {
  const provider = args.find((arg) => !arg.startsWith("-"));
  if (!provider) throw new Error("Usage: nerve auth remove <provider>");
  await apiDelete<{ ok: true }>(
    `/api/auth/providers/${encodeURIComponent(provider)}`,
  );
  console.log(`Removed credentials for ${provider}.`);
}

export async function commandAuth(args: string[]): Promise<void> {
  const [subcommand = "list", ...rest] = args;
  if (subcommand === "list") {
    await commandAuthList();
    return;
  }
  if (subcommand === "login") {
    await commandAuthLogin(rest);
    return;
  }
  if (subcommand === "set-key") {
    await commandAuthSetKey(rest);
    return;
  }
  if (subcommand === "remove") {
    await commandAuthRemove(rest);
    return;
  }
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printAuthHelp();
    return;
  }
  console.error(`unknown auth command: ${subcommand}`);
  printAuthHelp();
  process.exit(2);
}
