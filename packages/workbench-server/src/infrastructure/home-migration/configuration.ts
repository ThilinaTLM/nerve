import {
  defaultUserConfiguration,
  providerCatalogSchema,
  providersConfigSchema,
  type Settings,
  type UserConfiguration,
} from "@nervekit/contracts";
import { configurationWithSettings } from "../configuration/home-configuration.js";

export interface LegacyConfigurationSource {
  settings: Settings;
  providerCatalog?: unknown;
  credentialNames: Iterable<string>;
  userRules: Array<{
    id: string;
    effect: "allow" | "deny";
    tool_name: string;
    matcher_kind: "whole_tool" | "path_glob" | "command_glob" | "url_glob";
    pattern: string;
    enabled: number;
  }>;
}

export function migrateLegacyConfiguration(
  source: LegacyConfigurationSource,
): UserConfiguration {
  const base = configurationWithSettings(
    defaultUserConfiguration,
    source.settings,
  );
  const catalog = source.providerCatalog
    ? providerCatalogSchema.parse(source.providerCatalog)
    : { version: 1 as const, providers: [], models: [] };
  const authentication = [...source.credentialNames]
    .map((name) => {
      const match = /^provider:(.+):(apiKey|oauth)$/.exec(name);
      return match
        ? {
            provider: match[1],
            method:
              match[2] === "oauth" ? ("oauth" as const) : ("api_key" as const),
            credential: name,
          }
        : undefined;
    })
    .filter((value) => value !== undefined)
    .sort((left, right) => left.provider.localeCompare(right.provider));
  const rules = new Map(base.permissions.rules.map((rule) => [rule.id, rule]));
  for (const rule of source.userRules) {
    rules.set(rule.id, {
      id: rule.id,
      effect: rule.effect,
      tool: rule.tool_name,
      matcher: { kind: rule.matcher_kind, pattern: rule.pattern },
      enabled: rule.enabled === 1,
    });
  }
  return {
    ...base,
    permissions: { version: 1, rules: [...rules.values()] },
    providers: providersConfigSchema.parse({
      version: 1,
      providers: catalog.providers.map(({ headers, ...provider }) => ({
        ...provider,
        headers: Object.fromEntries(
          Object.entries(headers).map(([name, value]) => [name, { value }]),
        ),
      })),
      models: catalog.models.map(({ headers, ...model }) => ({
        ...model,
        ...(headers
          ? {
              headers: Object.fromEntries(
                Object.entries(headers).map(([name, value]) => [
                  name,
                  { value },
                ]),
              ),
            }
          : {}),
      })),
      authentication,
    }),
  };
}
