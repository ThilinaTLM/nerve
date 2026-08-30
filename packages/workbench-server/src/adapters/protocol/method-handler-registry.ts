import {
  allOperationDefinitions,
  type OperationName,
  type OperationParams,
} from "@nervekit/contracts/operations";
import type { OperationHandlerRegistry } from "@nervekit/protocol/server";
import type { PerformanceDiagnosticsPort } from "../../core/ports/diagnostics.js";

type MaybePromise<T> = T | Promise<T>;

type WorkbenchMethodHandler<M extends OperationName, Context extends object> = (
  state: Context,
  params: OperationParams<M>,
) => MaybePromise<unknown>;

export type WorkbenchMethodHandlerMapFor<Context extends object> = {
  readonly [M in OperationName]?: WorkbenchMethodHandler<M, Context>;
};

export function defineWorkbenchMethodHandlersFor<Context extends object>() {
  return <const Handlers extends WorkbenchMethodHandlerMapFor<Context>>(
    handlers: Handlers,
  ): Handlers => handlers;
}

export function bindWorkbenchMethodHandlerGroup<Context extends object>(
  handlers: WorkbenchMethodHandlerMapFor<Context>,
  context: Context,
  diagnostics: PerformanceDiagnosticsPort,
): Partial<OperationHandlerRegistry> {
  return Object.fromEntries(
    Object.entries(handlers).map(([method, handler]) => [
      method,
      async (params: unknown) => {
        const operation = method as OperationName;
        const invoke = handler as WorkbenchMethodHandler<
          OperationName,
          Context
        >;
        if (!diagnostics.enabled) return invoke(context, params as never);
        const startedAt = performance.now();
        try {
          return await invoke(context, params as never);
        } catch (error) {
          diagnostics.count("rpc.error", 1, operation);
          throw error;
        } finally {
          diagnostics.duration(
            "rpc.handler",
            performance.now() - startedAt,
            operation,
          );
        }
      },
    ]),
  ) as Partial<OperationHandlerRegistry>;
}

export function combineWorkbenchMethodHandlerGroups(
  groups: readonly Partial<OperationHandlerRegistry>[],
): {
  methods: readonly OperationName[];
  handlers: Partial<OperationHandlerRegistry>;
} {
  const handlers = new Map<
    OperationName,
    OperationHandlerRegistry[OperationName]
  >();
  const duplicates: OperationName[] = [];
  for (const group of groups) {
    for (const [method, handler] of Object.entries(group) as [
      OperationName,
      OperationHandlerRegistry[OperationName],
    ][]) {
      if (handlers.has(method)) duplicates.push(method);
      handlers.set(method, handler);
    }
  }
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate workbench operation handlers: ${sorted(duplicates).join(", ")}`,
    );
  }
  const expectedMethods = allOperationDefinitions()
    .filter((definition) =>
      definition.allowedTargetRoles.includes("workbench_server"),
    )
    .map((definition) => definition.method);
  const expected = new Set(expectedMethods);
  const missing = expectedMethods.filter((method) => !handlers.has(method));
  const unexpected = [...handlers.keys()].filter(
    (method) => !expected.has(method),
  );
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      [
        missing.length > 0
          ? `missing: ${sorted(missing).join(", ")}`
          : undefined,
        unexpected.length > 0
          ? `unexpected: ${sorted(unexpected).join(", ")}`
          : undefined,
      ]
        .filter(Boolean)
        .join("; ")
        .replace(/^/, "Workbench operation handler coverage mismatch: "),
    );
  }
  return {
    methods: expectedMethods,
    handlers: Object.fromEntries(handlers) as Partial<OperationHandlerRegistry>,
  };
}

function sorted(methods: readonly OperationName[]): OperationName[] {
  return [...new Set(methods)].sort();
}
