/* eslint-disable @typescript-eslint/no-explicit-any -- method tables hold methods of different session and input types */
import type {
  Authorization,
  AuthorizeResult,
  ExtensionDefinition,
  MethodDefinition,
  NamespaceDefinition,
  OwnToolDefinition,
  Risk,
} from "@nervekit/extension-api";
import type { AccountKind } from "@nervekit/contracts/extensions";
import { ToolExecutionError } from "../../execution/index.js";
import type { ExtensionManifest, SdkNamespace } from "../manifest-types.js";
import type {
  NestedCheck,
  PreparedCall,
  SdkEnvironment,
  SdkMethod,
} from "../runtime/sdk-types.js";
import { toHostError } from "./errors.js";

const asArray = (result: AuthorizeResult): Authorization[] =>
  result === undefined
    ? []
    : Array.isArray(result)
      ? [...(result as readonly Authorization[])]
      : [result as Authorization];

/** An authorization as the executor's nested check: the operation defaults to `<namespace>.<method>`, the risk to the method's. */
export function toNestedCheck(
  authorization: Authorization,
  operation: string,
  risk: Risk,
): NestedCheck {
  if ("toolName" in authorization) return authorization;
  return {
    operation: authorization.operation ?? operation,
    targets: authorization.targets.map((target) =>
      typeof target === "string" ? { kind: "resource", value: target } : target,
    ),
    risk: authorization.risk ?? risk,
    summary: authorization.summary,
  };
}

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
    signature: method.signature,
    prepare(args, env): PreparedCall {
      assertNamespaceAvailable(namespace.id, env);
      const input = method.parse(args);
      const checks = orderedChecks(
        asArray(method.authorize?.(input)).map((authorization) =>
          toNestedCheck(authorization, operation, method.risk),
        ),
      );
      return {
        authorization: checks[0],
        additionalAuthorizations: checks.slice(1),
        resource: method.resource?.(input) ?? checks[0]?.summary ?? "",
        run: async (runEnv) => {
          runEnv.extensions.allowReads(declaredReadPaths(checks));
          try {
            const session = await runEnv.extensions.session(
              definition,
              namespace,
            );
            return await method.run(
              session,
              input,
              runEnv.extensions.context(definition, {
                name: operation,
                risk: method.risk,
              }),
            );
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
    ...(namespace.availability ? { availability: namespace.availability } : {}),
    summary: namespace.summary,
    ...(namespace.rules ? { rules: [...namespace.rules] } : {}),
    methods: Object.entries(namespace.methods).map(([path, method]) =>
      toSdkMethod(definition, namespace, path, method),
    ),
    ...(namespace.configuration
      ? {
          // Without host ports (a bare runtime) there is nothing to describe.
          configuration: (env) =>
            env.context.extensionPorts
              ? namespace.configuration!(env.extensions.context(definition))
              : undefined,
        }
      : {}),
    types: namespace.types,
    docs: [...(namespace.docs ?? [])],
  };
}

/** The registry's view of an extension built on the extension API. */
export function fromDefinition(
  definition: ExtensionDefinition,
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
    source: "builtin",
    icon: definition.icon,
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
    prepare(args): PreparedCall {
      const input = tool.parse((args[0] ?? {}) as Record<string, unknown>);
      const checks = orderedChecks(
        asArray(tool.authorize?.(input)).map((authorization) =>
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
            return await tool.run(
              input,
              runEnv.extensions.context(definition, {
                name: operation,
                risk: tool.risk,
              }),
            );
          } catch (error) {
            throw toHostError(error);
          }
        },
      };
    },
  };
}
