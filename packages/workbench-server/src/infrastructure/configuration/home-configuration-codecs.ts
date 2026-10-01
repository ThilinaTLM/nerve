import { asyncSubagentToolNames } from "@nervekit/contracts/agents";
import {
  daemonConfigSchema,
  defaultDaemonConfig,
  defaultHarnessConfig,
  defaultIntegrationsConfig,
  defaultPermissionsConfig,
  defaultProvidersConfig,
  defaultUiConfig,
  harnessConfigSchema,
  integrationsConfigSchema,
  permissionsConfigSchema,
  providersConfigSchema,
  uiConfigSchema,
  type UserConfiguration,
} from "@nervekit/contracts/settings";
import {
  createConfigurationCodec,
  type ConfigurationCodec,
} from "../persistence/payloads/config-codec.js";
import type { PayloadUpgraderChain } from "../persistence/payloads/codec.js";
import {
  isJsonObject,
  mergePreservingUnknown,
} from "../persistence/payloads/merge.js";

export type HomeConfigurationDocumentId = keyof UserConfiguration;

/** Pure v1 -> v2 conversion formerly implicit in the harness read schema. */
export function upgradeHarnessV1ToV2(value: unknown): unknown {
  if (!isJsonObject(value) || value.version !== 1) return value;
  const tools = isJsonObject(value.tools) ? value.tools : undefined;
  const disabled = Array.isArray(tools?.disabled) ? tools.disabled : [];
  return mergePreservingUnknown(value, {
    version: 2,
    ...(tools
      ? {
          tools: {
            disabled: [...new Set([...disabled, ...asyncSubagentToolNames])],
          },
        }
      : {}),
  });
}

/** Introduce diagram export without enabling network access in existing homes. */
export function upgradeHarnessV2ToV3(value: unknown): unknown {
  if (!isJsonObject(value) || value.version !== 2) return value;
  const tools = isJsonObject(value.tools) ? value.tools : undefined;
  const disabled = Array.isArray(tools?.disabled)
    ? tools.disabled
    : defaultHarnessConfig.tools.disabled;
  return mergePreservingUnknown(value, {
    version: 3,
    tools: {
      kroki: tools?.kroki ?? defaultHarnessConfig.tools.kroki,
      disabled: [...new Set([...disabled, "kroki_export"])],
    },
  });
}

/** Pure conversion of the schemaVersion 1 overlay envelope. */
export function upgradePermissionsV1ToV2(value: unknown): unknown {
  if (
    !isJsonObject(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.rules)
  ) {
    return value;
  }
  return mergePreservingUnknown(value, {
    schemaVersion: 2,
    overlays: [{ ruleSetId: "baseline", rules: value.rules }],
  });
}

const harnessUpgraders = {
  1: upgradeHarnessV1ToV2,
  2: upgradeHarnessV2ToV3,
} satisfies PayloadUpgraderChain;
const permissionsUpgraders = {
  1: upgradePermissionsV1ToV2,
} satisfies PayloadUpgraderChain;

export const HOME_CONFIGURATION_CODECS: {
  readonly [K in HomeConfigurationDocumentId]: ConfigurationCodec<
    UserConfiguration[K]
  >;
} = {
  daemon: createConfigurationCodec({
    currentVersion: 1,
    defaults: defaultDaemonConfig,
    version: versionField("version"),
    read: (value) => daemonConfigSchema.parse(value),
  }),
  harness: createConfigurationCodec({
    currentVersion: 3,
    defaults: defaultHarnessConfig,
    version: versionField("version"),
    upgraders: harnessUpgraders,
    read: (value) => harnessConfigSchema.parse(value),
  }),
  ui: createConfigurationCodec({
    currentVersion: 1,
    defaults: defaultUiConfig,
    version: versionField("version"),
    read: (value) => uiConfigSchema.parse(value),
  }),
  permissions: createConfigurationCodec({
    currentVersion: 2,
    defaults: defaultPermissionsConfig,
    version: versionField("schemaVersion"),
    upgraders: permissionsUpgraders,
    read: (value) => permissionsConfigSchema.parse(value),
  }),
  providers: createConfigurationCodec({
    currentVersion: 1,
    defaults: defaultProvidersConfig,
    version: versionField("version"),
    read: (value) => providersConfigSchema.parse(value),
  }),
  integrations: createConfigurationCodec({
    currentVersion: 1,
    defaults: defaultIntegrationsConfig,
    version: versionField("version"),
    read: (value) => integrationsConfigSchema.parse(value),
  }),
};

function versionField(field: string): (value: unknown) => number {
  return (value) => {
    if (!isJsonObject(value) || !Number.isSafeInteger(value[field])) {
      throw new Error(`Missing or invalid '${field}' version field.`);
    }
    return Number(value[field]);
  };
}
