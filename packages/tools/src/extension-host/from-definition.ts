/* eslint-disable @typescript-eslint/no-explicit-any -- method tables hold methods of different session and input types */
import type {
  ExtensionDefinition,
  MethodDefinition,
  NamespaceDefinition,
  OwnToolDefinition,
} from "@nervekit/extension-api";
import type { HostExtensionDefinition } from "@nervekit/extension-api/host";
import type {
  AccountKind,
  ExtensionIcon,
  ExtensionSource,
} from "@nervekit/contracts/extensions";
import { ToolExecutionError } from "../execution/index.js";
import { toNestedCheck } from "../quick-script/runtime/sdk-args.js";
import type {
  ExtensionManifest,
  SdkNamespace,
} from "../quick-script/manifest-types.js";
import type {
  NestedCheck,
  PreparedCall,
  SdkEnvironment,
  SdkMethod,
} from "../quick-script/runtime/sdk-types.js";
import type { CodeTarget } from "./code-adapter.js";
import { toHostError } from "./errors.js";

/** Operation checks first (they name the call), then host-tool checks such as workspace reads. */
export function orderedChecks(checks: NestedCheck[]): NestedCheck[] {
  return [
    ...checks.filter((check) => "operation" in check),
    ...checks.filter((check) => !("operation" in check)),
  ];
}

/** Workspace files the method declared it reads; they are opened to `ctx.artifacts.read` once the checks pass. */
export function declaredReadPaths(checks: readonly NestedCheck[]): string[] {
  return checks.flatMap((check) =>
    "toolName" in check &&
    check.toolName === "read" &&
    typeof check.args.path === "string"
      ? [check.args.path]
      : [],
  );
}

/** Fails a call into a namespace the host reports as unavailable, with its reason and fix. */
export function assertNamespaceAvailable(
  namespace: string,
  env: SdkEnvironment,
): void {
  const state = env.context.namespaces?.[namespace];
  if (!state || (state.configured && state.available)) return;
  throw new ToolExecutionError(
    "BAD_REQUEST",
    state.available
      ? `${namespace} is not enabled. Ask the user to enable it in Settings → Extensions.`
      : `${namespace} is unavailable: ${state.reason} ${state.fix}`,
  );
}

function toSdkMethod(
  definition: ExtensionDefinition,
  namespace: NamespaceDefinition<any>,
  path: string,
  method: MethodDefinition<any, any, any>,
): SdkMethod {
  const operation = `${namespace.id}.${path}`;
  return {
    product: namespace.id,
    path,
    risk: method.risk,
    ...(method.riskFromArgs ? { riskFromArgs: true } : {}),
    signature: method.signature,
    async prepare(args, env): Promise<PreparedCall> {
      assertNamespaceAvailable(namespace.id, env);
      const target: CodeTarget = {
        kind: "method",
        namespace: namespace.id,
        path,
      };
      const code = await env.extensions.code(definition);
      // Parse and authorize complete before any I/O of the call and before approval.
      const input = await code.parse(target, args);
      const checks = orderedChecks(
        (await code.authorize(target, input)).map((authorization) =>
          toNestedCheck(authorization, operation, method.risk),
        ),
      );
      return {
        authorization: checks[0],
        additionalAuthorizations: checks.slice(1),
        resource:
          (await code.resource(target, input)) ?? checks[0]?.summary ?? "",
        run: async (runEnv) => {
          runEnv.extensions.allowReads(declaredReadPaths(checks));
          try {
            return await (
              await runEnv.extensions.code(definition)
            ).run(target, input, { name: operation, risk: method.risk });
          } catch (error) {
            throw toHostError(error);
          }
        },
      };
    },
  };
}

function toSdkNamespace(
  definition: ExtensionDefinition,
  namespace: NamespaceDefinition<any>,
): SdkNamespace {
  return {
    id: namespace.id,
    ...(namespace.label ? { label: namespace.label } : {}),
    ...(namespace.enabledBy
      ? {
          enabledBy:
            typeof namespace.enabledBy === "string"
              ? namespace.enabledBy
              : [...namespace.enabledBy],
        }
      : {}),
    ...(namespace.requires ? { requires: namespace.requires } : {}),
    ...(namespace.helper ? { helper: true } : {}),
    ...(namespace.availability ? { availability: true as const } : {}),
    summary: namespace.summary,
    ...(namespace.rules ? { rules: [...namespace.rules] } : {}),
    methods: Object.entries(namespace.methods).map(([path, method]) =>
      toSdkMethod(definition, namespace, path, method),
    ),
    ...(namespace.configuration
      ? {
          // Without host ports (a bare runtime) there is nothing to describe.
          configuration: async (env) =>
            env.context.extensionPorts
              ? await (
                  await env.extensions.code(definition)
                ).configuration(namespace.id)
              : undefined,
        }
      : {}),
    types: namespace.types,
    docs: [...(namespace.docs ?? [])],
  };
}

/** The registry's view of an extension built on the extension API. */
export function fromDefinition(
  definition: HostExtensionDefinition,
  icon: ExtensionIcon,
  source: ExtensionSource = "builtin",
): ExtensionManifest {
  const accounts: AccountKind[] = Object.entries(definition.accounts ?? {}).map(
    ([kind, { test, ...data }]) => ({
      kind,
      ...data,
      ...(test ? { test: true as const } : {}),
    }),
  );
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    source,
    icon,
    enabledByDefault: definition.enabledByDefault,
    settings: {
      ...(definition.settings.sections
        ? { sections: definition.settings.sections }
        : {}),
      fields: definition.settings.fields,
    },
    settingsVersion: definition.settings.version,
    ...(definition.settings.migrations
      ? { migrations: definition.settings.migrations }
      : {}),
    ...(accounts.length > 0 ? { accounts } : {}),
    ...(definition.uses?.length ? { uses: [...definition.uses] } : {}),
    ...(definition.permissions ? { permissions: definition.permissions } : {}),
    definition,
    ...(definition.tools ? { tools: definition.tools } : {}),
    ...(definition.prelude ? { prelude: definition.prelude } : {}),
    ...(definition.limits ? { limits: definition.limits } : {}),
    contributes: {
      sdk: definition.namespaces.map((namespace) =>
        toSdkNamespace(definition, namespace),
      ),
      tools: (definition.tools ?? []).map((tool) => tool.name),
    },
  };
}

/** A direct tool with its own implementation, as a method: the arguments object is its single argument. */
export function sdkMethodForOwnTool(
  definition: ExtensionDefinition,
  tool: OwnToolDefinition,
): SdkMethod {
  const operation = `${definition.id}.${tool.name}`;
  return {
    product: definition.id,
    path: tool.name,
    risk: tool.risk,
    signature: "",
    async prepare(args, env): Promise<PreparedCall> {
      const target: CodeTarget = { kind: "tool", name: tool.name };
      const code = await env.extensions.code(definition);
      const input = await code.parse(target, args);
      const checks = orderedChecks(
        (await code.authorize(target, input)).map((authorization) =>
          toNestedCheck(authorization, operation, tool.risk),
        ),
      );
      return {
        authorization: checks[0],
        additionalAuthorizations: checks.slice(1),
        resource: checks[0]?.summary ?? "",
        run: async (runEnv) => {
          runEnv.extensions.allowReads(declaredReadPaths(checks));
          try {
            return await (
              await runEnv.extensions.code(definition)
            ).run(target, input, { name: operation, risk: tool.risk });
          } catch (error) {
            throw toHostError(error);
          }
        },
      };
    },
  };
}
