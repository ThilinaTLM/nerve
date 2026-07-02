import { z } from "zod";

const extensionRecordSchema = z.record(z.string(), z.unknown());
const stringRecordSchema = z.record(z.string(), z.string());

export const sandboxSecretKvRefSchema = z.object({
  store: z.string().min(1).optional(),
  key: z.string().min(1),
  version: z.string().min(1).optional(),
});
export type SandboxSecretKvRef = z.infer<typeof sandboxSecretKvRefSchema>;

export const sandboxSecretRefSchema = z.union([
  z.object({ env: z.string().min(1) }),
  z.object({ file: z.string().min(1) }),
  z.object({ kv: sandboxSecretKvRefSchema }),
]);
export type SandboxSecretRef = z.infer<typeof sandboxSecretRefSchema>;

const apiKeyCredentialSchema = z.object({
  type: z.literal("api_key"),
  apiKey: sandboxSecretRefSchema,
  headerName: z.string().min(1).optional(),
  prefix: z.string().min(1).optional(),
});

const bearerCredentialSchema = z.object({
  type: z.literal("bearer"),
  token: sandboxSecretRefSchema,
});

const basicCredentialSchema = z.object({
  type: z.literal("basic"),
  username: z.string().min(1),
  password: sandboxSecretRefSchema,
});

export const oauthCredentialSchema = z.object({
  type: z.literal("oauth"),
  provider: z.string().min(1).optional(),
  source: sandboxSecretRefSchema.optional(),
  accessToken: sandboxSecretRefSchema.optional(),
  refreshToken: sandboxSecretRefSchema.optional(),
  expiresAt: z.union([z.string().min(1), sandboxSecretRefSchema]).optional(),
  refresh: z
    .object({
      enabled: z.boolean().optional(),
      minTtlMs: z.number().int().nonnegative().safe().optional(),
      persist: z.enum(["state", "file", "none"]).optional(),
      file: z.string().min(1).optional(),
    })
    .optional(),
});
export type SandboxOAuthCredential = z.infer<typeof oauthCredentialSchema>;

const sshCredentialSchema = z.object({
  type: z.literal("ssh"),
  privateKey: sandboxSecretRefSchema,
  passphrase: sandboxSecretRefSchema.optional(),
  publicKey: sandboxSecretRefSchema.optional(),
  knownHosts: sandboxSecretRefSchema.optional(),
});

const gpgCredentialSchema = z.object({
  type: z.literal("gpg"),
  privateKey: sandboxSecretRefSchema,
  passphrase: sandboxSecretRefSchema.optional(),
  keyId: z.string().min(1).optional(),
});

export const sandboxCredentialConfigSchema = z.discriminatedUnion("type", [
  apiKeyCredentialSchema,
  bearerCredentialSchema,
  basicCredentialSchema,
  oauthCredentialSchema,
  sshCredentialSchema,
  gpgCredentialSchema,
]);
export type SandboxCredentialConfig = z.infer<
  typeof sandboxCredentialConfigSchema
>;

export const sandboxSecretStoreAuthSchema = z.union([
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("api_key"),
    apiKey: sandboxSecretRefSchema,
    header: z.string().min(1).optional(),
    scheme: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal("bearer"), token: sandboxSecretRefSchema }),
  oauthCredentialSchema,
]);

export const sandboxHttpKvSecretStoreConfigSchema = z.object({
  type: z.literal("http_kv"),
  endpoint: z.string().url(),
  method: z.enum(["GET", "POST"]).optional(),
  keyParam: z.string().min(1).optional(),
  versionParam: z.string().min(1).optional(),
  response: z
    .object({
      valueJsonPointer: z.string().min(1).optional(),
      expiresAtJsonPointer: z.string().min(1).optional(),
    })
    .optional(),
  auth: sandboxSecretStoreAuthSchema.optional(),
  cache: z
    .object({
      enabled: z.boolean().optional(),
      ttlMs: z.number().int().nonnegative().safe().optional(),
      maxEntries: z.number().int().positive().safe().optional(),
    })
    .optional(),
  timeoutMs: z.number().int().positive().safe().optional(),
});
export type SandboxHttpKvSecretStoreConfig = z.infer<
  typeof sandboxHttpKvSecretStoreConfigSchema
>;

export const sandboxSecretStoresConfigSchema = z.object({
  defaultStore: z.string().min(1).optional(),
  stores: z
    .record(z.string().min(1), sandboxHttpKvSecretStoreConfigSchema)
    .optional(),
});
export type SandboxSecretStoresConfig = z.infer<
  typeof sandboxSecretStoresConfigSchema
>;

export const sandboxAgentModelSelectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  thinkingLevel: z
    .enum(["off", "minimal", "low", "medium", "high", "xhigh"])
    .optional(),
});
export type SandboxAgentModelSelection = z.infer<
  typeof sandboxAgentModelSelectionSchema
>;

export const sandboxModelCatalogConfigSchema = z.object({
  providers: z
    .array(
      z.object({
        id: z.string().min(1),
        displayName: z.string().min(1).optional(),
        builtin: z.boolean().optional(),
        api: z.string().min(1).optional(),
        baseUrl: z.string().url().optional(),
        headers: stringRecordSchema.optional(),
        compat: extensionRecordSchema.optional(),
        credential: sandboxCredentialConfigSchema.optional(),
        providerOptions: extensionRecordSchema.optional(),
      }),
    )
    .optional(),
  models: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        provider: z.string().min(1),
        model: z.string().min(1),
        displayName: z.string().min(1).optional(),
        contextWindow: z.number().int().positive().safe().optional(),
        maxOutputTokens: z.number().int().positive().safe().optional(),
        supportsThinking: z.boolean().optional(),
        modelOptions: extensionRecordSchema.optional(),
      }),
    )
    .optional(),
});

export const sandboxAgentConfigSchema = z.object({
  mainModel: sandboxAgentModelSelectionSchema,
  exploreModel: sandboxAgentModelSelectionSchema.optional(),
  initialPrompt: z.string().min(1).optional(),
  systemPromptAmendment: z.string().min(1).optional(),
  mode: z.enum(["normal", "planning"]).optional(),
  permissionLevel: z.enum(["read_only", "supervised", "autonomous"]).optional(),
  workspaceRoot: z.string().min(1).optional(),
  maxRuns: z.number().int().positive().safe().optional(),
  maxExploreDepth: z.number().int().nonnegative().safe().optional(),
});
export type SandboxAgentConfig = z.infer<typeof sandboxAgentConfigSchema>;

export const sandboxControllerConfigSchema = z.object({
  websocket: z.object({
    url: z.string().url(),
    connectTimeoutMs: z.number().int().positive().safe().optional(),
    heartbeatIntervalMs: z.number().int().positive().safe().optional(),
    reconnect: z
      .object({
        minDelayMs: z.number().int().nonnegative().safe().optional(),
        maxDelayMs: z.number().int().positive().safe().optional(),
        multiplier: z.number().positive().safe().optional(),
        jitter: z.boolean().optional(),
      })
      .optional(),
    headers: stringRecordSchema.optional(),
  }),
  auth: z.object({
    type: z.literal("api_key"),
    apiKey: sandboxSecretRefSchema,
    header: z.string().min(1).optional(),
    scheme: z.string().min(1).optional(),
  }),
  disconnectPolicy: z
    .object({
      mode: z.enum(["exit_self", "stay_reconnecting"]).optional(),
      exitAfterMs: z.number().int().positive().safe().optional(),
    })
    .optional(),
});
export type SandboxControllerConfig = z.infer<
  typeof sandboxControllerConfigSchema
>;

const toolGroupConfigSchema = z.object({
  enabled: z.boolean().optional(),
  tools: z
    .object({
      enabled: z.array(z.string().min(1)).optional(),
      disabled: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  requireApproval: z.enum(["never", "risky", "always"]).optional(),
  toolOptions: extensionRecordSchema.optional(),
});

const credentialToolGroupConfigSchema = toolGroupConfigSchema.extend({
  provider: z.string().min(1).optional(),
  siteUrl: z.string().url().optional(),
  baseUrl: z.string().url().optional(),
  email: z.string().email().optional(),
  credential: sandboxCredentialConfigSchema.optional(),
  defaultProjectKey: z.string().min(1).optional(),
  defaultSpaceKey: z.string().min(1).optional(),
  maxFetchBytes: z.number().int().positive().safe().optional(),
  allowedContentTypes: z.array(z.string().min(1)).optional(),
});

export const sandboxToolsConfigSchema = z.object({
  groups: z
    .object({
      fileInspection: toolGroupConfigSchema.optional(),
      fileEditing: toolGroupConfigSchema.optional(),
      planMode: toolGroupConfigSchema.optional(),
      todos: toolGroupConfigSchema.optional(),
      web: credentialToolGroupConfigSchema.optional(),
      jira: credentialToolGroupConfigSchema.optional(),
      confluence: credentialToolGroupConfigSchema.optional(),
      taskManagement: toolGroupConfigSchema
        .extend({
          maxTasks: z.number().int().positive().safe().optional(),
          maxTaskRuntimeMs: z.number().int().positive().safe().optional(),
          allowNetworkListeners: z.boolean().optional(),
        })
        .optional(),
      shell: toolGroupConfigSchema
        .extend({
          defaultTimeoutMs: z.number().int().positive().safe().optional(),
          maxTimeoutMs: z.number().int().positive().safe().optional(),
          allowLongRunning: z.boolean().optional(),
          envAllowlist: z.array(z.string().min(1)).optional(),
        })
        .optional(),
      python: toolGroupConfigSchema
        .extend({
          executablePath: z.string().min(1).optional(),
          network: z.enum(["inherit", "deny", "allow"]).optional(),
          fileWrites: z.enum(["workspace", "deny"]).optional(),
        })
        .optional(),
      explore: toolGroupConfigSchema
        .extend({
          maxDepth: z.number().int().nonnegative().safe().optional(),
          maxParallel: z.number().int().positive().safe().optional(),
        })
        .optional(),
    })
    .optional(),
});
export type SandboxToolsConfig = z.infer<typeof sandboxToolsConfigSchema>;

export const sandboxGitConfigSchema = z.object({
  enabled: z.boolean().optional(),
  identity: z
    .object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      signCommits: z.boolean().optional(),
      signingFormat: z.enum(["openpgp", "ssh"]).optional(),
      signingKeyId: z.string().min(1).optional(),
      gpgPrivateKey: sandboxSecretRefSchema.optional(),
      gpgPassphrase: sandboxSecretRefSchema.optional(),
      sshSigningKey: sandboxSecretRefSchema.optional(),
    })
    .optional(),
  clone: z
    .object({
      url: z.string().min(1).optional(),
      ref: z.string().min(1).optional(),
      targetDir: z.string().min(1).optional(),
      depth: z.number().int().positive().safe().optional(),
      submodules: z.boolean().optional(),
      credential: sandboxCredentialConfigSchema.optional(),
      ifWorkspaceNotEmpty: z.enum(["skip", "fail", "replace"]).optional(),
    })
    .optional(),
  remotes: z
    .array(
      z.object({
        name: z.string().min(1),
        url: z.string().min(1),
        credential: sandboxCredentialConfigSchema.optional(),
      }),
    )
    .optional(),
  safeDirectory: z
    .union([
      z.literal("workspace"),
      z.literal("none"),
      z.array(z.string().min(1)),
    ])
    .optional(),
  lfs: z.boolean().optional(),
  defaultBranch: z.string().min(1).optional(),
});

export const sandboxGithubConfigSchema = z.object({
  enabled: z.boolean().optional(),
  host: z.string().min(1).optional(),
  auth: z
    .union([
      z.object({ type: z.literal("pat"), token: sandboxSecretRefSchema }),
      z.object({ type: z.literal("app_token"), token: sandboxSecretRefSchema }),
      z.object({
        type: z.literal("ssh"),
        privateKey: sandboxSecretRefSchema,
        passphrase: sandboxSecretRefSchema.optional(),
        knownHosts: sandboxSecretRefSchema.optional(),
      }),
      oauthCredentialSchema,
    ])
    .optional(),
  cli: z
    .object({
      enabled: z.boolean().optional(),
      protocol: z.enum(["https", "ssh"]).optional(),
    })
    .optional(),
  defaultOwner: z.string().min(1).optional(),
  defaultRepo: z.string().min(1).optional(),
});

export const sandboxSkillsConfigSchema = z.object({
  enabled: z.boolean().optional(),
  contextFiles: z
    .object({
      enabled: z.boolean().optional(),
      names: z.array(z.string().min(1)).optional(),
      includeAncestors: z.boolean().optional(),
    })
    .optional(),
  builtin: z
    .object({
      enabled: z.boolean().optional(),
      path: z.string().min(1).optional(),
      include: z.array(z.string().min(1)).optional(),
      exclude: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  project: z
    .object({
      enabled: z.boolean().optional(),
      path: z.string().min(1).optional(),
      includeAncestors: z.boolean().optional(),
    })
    .optional(),
  searchPaths: z.array(z.string().min(1)).optional(),
  allowWorkspaceSkills: z.boolean().optional(),
  legacyNervePaths: z.boolean().optional(),
  maxSkillBytes: z.number().int().positive().safe().optional(),
  maxSkillCount: z.number().int().positive().safe().optional(),
});

export const sandboxBootConfigSchema = z.object({
  script: z.string().min(1).optional(),
  phases: z
    .array(
      z.object({
        name: z.string().min(1),
        script: z.string().min(1),
        timeoutMs: z.number().int().positive().safe().optional(),
        runAs: z.enum(["sandbox", "root"]).optional(),
        network: z
          .enum(["inherit", "deny", "package_registries_only"])
          .optional(),
        env: z.record(z.string().min(1), sandboxSecretRefSchema).optional(),
      }),
    )
    .optional(),
  timeoutMs: z.number().int().positive().safe().optional(),
  runAs: z.enum(["sandbox", "root"]).optional(),
  onFailure: z.enum(["fail_sandbox", "continue_readonly"]).optional(),
  network: z.enum(["inherit", "deny", "package_registries_only"]).optional(),
});

export const sandboxSecurityConfigSchema = z.object({
  filesystem: z
    .object({
      workspaceDir: z.string().min(1).optional(),
      stateDir: z.string().min(1).optional(),
      tempDir: z.string().min(1).optional(),
      agentDir: z.string().min(1).optional(),
      builtinSkillsDir: z.string().min(1).optional(),
      writable: z.array(z.string().min(1)).optional(),
      readonly: z.array(z.string().min(1)).optional(),
      denySymlinkEscape: z.boolean().optional(),
    })
    .optional(),
  network: z
    .object({
      default: z.enum(["allow", "deny"]).optional(),
      allow: z.array(z.string().min(1)).optional(),
      deny: z.array(z.string().min(1)).optional(),
      packageRegistryHosts: z.array(z.string().min(1)).optional(),
      dns: z.enum(["system", "controller", "disabled"]).optional(),
    })
    .optional(),
  apt: z
    .object({
      allowed: z.boolean().optional(),
      mode: z.enum(["disabled", "build_time_only", "runtime"]).optional(),
    })
    .optional(),
  process: z
    .object({
      runAsUser: z.string().min(1).optional(),
      noNewPrivileges: z.boolean().optional(),
      maxProcesses: z.number().int().positive().safe().optional(),
      maxTaskRuntimeMs: z.number().int().positive().safe().optional(),
    })
    .optional(),
  capabilities: z
    .object({
      dropAll: z.boolean().optional(),
      add: z.array(z.string().min(1)).optional(),
      privileged: z.boolean().optional(),
    })
    .optional(),
  firewall: z
    .object({
      enabled: z.boolean().optional(),
      backend: z
        .enum(["container", "iptables", "nftables", "proxy", "cni", "none"])
        .optional(),
      enforceBootPhaseNetwork: z.boolean().optional(),
    })
    .optional(),
});

export const sandboxStorageConfigSchema = z.object({
  stateDir: z.string().min(1).optional(),
  retention: z
    .object({
      maxRuns: z.number().int().positive().safe().optional(),
      maxAgeDays: z.number().int().positive().safe().optional(),
      maxBytes: z.number().int().positive().safe().optional(),
    })
    .optional(),
  checkpoint: z
    .object({
      onEveryTurn: z.boolean().optional(),
      intervalMs: z.number().int().positive().safe().optional(),
    })
    .optional(),
  credentials: z
    .object({
      dir: z.string().min(1).optional(),
      persistRefreshes: z.boolean().optional(),
    })
    .optional(),
  cache: z
    .object({
      dependencyDir: z.string().min(1).optional(),
      secretStoreDir: z.string().min(1).optional(),
    })
    .optional(),
});

export const sandboxResourceConfigSchema = z.object({
  cpu: z.string().min(1).optional(),
  memoryMb: z.number().int().positive().safe().optional(),
  diskMb: z.number().int().positive().safe().optional(),
  maxOpenFiles: z.number().int().positive().safe().optional(),
});

export const sandboxObservabilityConfigSchema = z.object({
  logLevel: z.enum(["debug", "info", "warn", "error"]).optional(),
  redact: z.array(z.string().min(1)).optional(),
  emitProviderMetadata: z.boolean().optional(),
});

export const sandboxConfigV1Schema = z
  .strictObject({
    version: z.literal(1),
    identity: z
      .object({
        sandboxId: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        labels: stringRecordSchema.optional(),
        annotations: stringRecordSchema.optional(),
      })
      .optional(),
    secretStores: sandboxSecretStoresConfigSchema.optional(),
    modelCatalog: sandboxModelCatalogConfigSchema.optional(),
    agent: sandboxAgentConfigSchema,
    controller: sandboxControllerConfigSchema,
    git: sandboxGitConfigSchema.optional(),
    github: sandboxGithubConfigSchema.optional(),
    tools: sandboxToolsConfigSchema.optional(),
    skills: sandboxSkillsConfigSchema.optional(),
    boot: sandboxBootConfigSchema.optional(),
    security: sandboxSecurityConfigSchema.optional(),
    storage: sandboxStorageConfigSchema.optional(),
    resources: sandboxResourceConfigSchema.optional(),
    observability: sandboxObservabilityConfigSchema.optional(),
  })
  .superRefine((config, context) => {
    const defaultStore = config.secretStores?.defaultStore;
    const stores = config.secretStores?.stores ?? {};
    if (defaultStore && !(defaultStore in stores)) {
      context.addIssue({
        code: "custom",
        path: ["secretStores", "defaultStore"],
        message: "secretStores.defaultStore must reference a configured store",
      });
    }
    if (containsKvRefWithoutStore(config) && !defaultStore) {
      context.addIssue({
        code: "custom",
        path: ["secretStores", "defaultStore"],
        message:
          "secretStores.defaultStore is required when a kv SecretRef omits store",
      });
    }
    const phases = config.boot?.phases ?? [];
    const names = new Set<string>();
    for (const phase of phases) {
      if (names.has(phase.name)) {
        context.addIssue({
          code: "custom",
          path: ["boot", "phases"],
          message: `duplicate boot phase name: ${phase.name}`,
        });
      }
      names.add(phase.name);
    }
  });
export type SandboxConfigV1 = z.infer<typeof sandboxConfigV1Schema>;

function containsKvRefWithoutStore(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsKvRefWithoutStore);
  const record = value as Record<string, unknown>;
  const kv = record.kv;
  if (kv && typeof kv === "object" && !Array.isArray(kv)) {
    const ref = kv as Record<string, unknown>;
    if (typeof ref.key === "string" && ref.store === undefined) return true;
  }
  return Object.values(record).some(containsKvRefWithoutStore);
}
