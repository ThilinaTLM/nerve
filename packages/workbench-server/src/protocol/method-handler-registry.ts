import {
  allOperationDefinitions,
  type OperationName,
  type OperationParams,
} from "@nervekit/contracts";
import type { OperationHandlerRegistry } from "@nervekit/protocol";
import type { OrchestratorState } from "../app/orchestrator-state.js";

type MaybePromise<T> = T | Promise<T>;

type WorkbenchMethodHandler<M extends OperationName> = (
  state: OrchestratorState,
  params: OperationParams<M>,
) => MaybePromise<unknown>;

export type WorkbenchMethodHandlerMap = {
  readonly [M in OperationName]?: WorkbenchMethodHandler<M>;
};

export function defineWorkbenchMethodHandlers<
  const Handlers extends WorkbenchMethodHandlerMap,
>(handlers: Handlers): Handlers {
  return handlers;
}

export interface WorkbenchMethodRegistry {
  readonly methods: readonly OperationName[];
  handle(
    state: OrchestratorState,
    method: OperationName,
    params: unknown,
  ): Promise<unknown>;
  bind(state: OrchestratorState): Partial<OperationHandlerRegistry>;
}

export function createWorkbenchMethodRegistry(
  groups: readonly WorkbenchMethodHandlerMap[],
): WorkbenchMethodRegistry {
  const handlers = new Map<
    OperationName,
    WorkbenchMethodHandler<OperationName>
  >();
  const duplicates: OperationName[] = [];

  for (const group of groups) {
    for (const [method, handler] of Object.entries(group) as [
      OperationName,
      WorkbenchMethodHandler<OperationName>,
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

  async function handle(
    state: OrchestratorState,
    method: OperationName,
    params: unknown,
  ): Promise<unknown> {
    const handler = handlers.get(method);
    if (!handler) throw new Error(`Unsupported workbench operation: ${method}`);
    return handler(state, params as never);
  }

  function bind(state: OrchestratorState): Partial<OperationHandlerRegistry> {
    return Object.fromEntries(
      expectedMethods.map((method) => [
        method,
        (params: unknown) => handle(state, method, params),
      ]),
    ) as unknown as Partial<OperationHandlerRegistry>;
  }

  return { methods: expectedMethods, handle, bind };
}

function sorted(methods: readonly OperationName[]): OperationName[] {
  return [...new Set(methods)].sort();
}
