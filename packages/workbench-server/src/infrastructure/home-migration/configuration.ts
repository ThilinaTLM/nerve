import {
  defaultUserConfiguration,
  providerCatalogSchema,
  providersConfigSchema,
  type Settings,
  type UserConfiguration,
} from "@nervekit/contracts";
import type { DatabaseSync } from "node:sqlite";
import { configurationWithSettings } from "../configuration/home-configuration.js";
import { readLegacyDocument } from "./legacy-v2.js";

export function migrateLegacyConfiguration(
  database: DatabaseSync,
  settings: Settings,
  credentialNames: Iterable<string>,
): UserConfiguration {
  const base = configurationWithSettings(defaultUserConfiguration, settings);
  const rawCatalog = readLegacyDocument<unknown>(
    database,
    "provider_catalog",
    "global",
    "catalog",
  );
  const catalog = rawCatalog
    ? providerCatalogSchema.parse(rawCatalog)
    : { version: 1 as const, providers: [], models: [] };
  const authentication = [...credentialNames]
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
  const userRules = database
    .prepare(
      `SELECT id, effect, tool_name, matcher_kind, pattern, enabled
       FROM permission_rules WHERE scope = 'user' ORDER BY id`,
    )
    .all() as Array<{
    id: string;
    effect: "allow" | "deny";
    tool_name: string;
    matcher_kind: "whole_tool" | "path_glob" | "command_glob" | "url_glob";
    pattern: string;
    enabled: number;
  }>;
  const rules = new Map(base.permissions.rules.map((rule) => [rule.id, rule]));
  for (const rule of userRules) {
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
