import type { AccountKind } from "@nervekit/extension-api";
import type { SearchProvider } from "./provider.js";
import { tavilyProvider } from "./tavily.js";

/** Every search backend, in the order their accounts are offered. */
export const searchProviders: readonly SearchProvider[] = [tavilyProvider];

export const providerAccounts: Readonly<Record<string, AccountKind>> =
  Object.fromEntries(
    searchProviders.map((provider) => [provider.kind, provider.account]),
  );

export function providerFor(kind: string): SearchProvider | undefined {
  return searchProviders.find((provider) => provider.kind === kind);
}
