export * from "@nervekit/harness";

/**
 * Host-neutral inputs needed to construct one harness. Provider discovery,
 * credentials, policy, filesystem paths, and concrete models remain adapters.
 */
export interface HarnessConstructionRequest<TScope, TContext> {
  readonly scope: TScope;
  readonly context: TContext;
}

export interface ResolvedHarnessEnvironment<TModel, TCredentials, TPolicy> {
  readonly model: TModel;
  readonly credentials: TCredentials;
  readonly policy: TPolicy;
}

export interface HarnessConstructionPorts<
  TScope,
  TContext,
  TModel,
  TCredentials,
  TPolicy,
  THarness,
> {
  resolveModel(scope: TScope, context: TContext): Promise<TModel>;
  resolveCredentials(scope: TScope, model: TModel): Promise<TCredentials>;
  resolvePolicy(scope: TScope, context: TContext): Promise<TPolicy>;
  create(input: {
    readonly scope: TScope;
    readonly context: TContext;
    readonly environment: ResolvedHarnessEnvironment<
      TModel,
      TCredentials,
      TPolicy
    >;
  }): Promise<THarness>;
}

/** One shared, ordered construction path used by both host adapters. */
export class HostHarnessFactory<
  TScope,
  TContext,
  TModel,
  TCredentials,
  TPolicy,
  THarness,
> {
  constructor(
    private readonly ports: HarnessConstructionPorts<
      TScope,
      TContext,
      TModel,
      TCredentials,
      TPolicy,
      THarness
    >,
  ) {}

  async create(
    request: HarnessConstructionRequest<TScope, TContext>,
  ): Promise<THarness> {
    const model = await this.ports.resolveModel(request.scope, request.context);
    const [credentials, policy] = await Promise.all([
      this.ports.resolveCredentials(request.scope, model),
      this.ports.resolvePolicy(request.scope, request.context),
    ]);
    return this.ports.create({
      scope: request.scope,
      context: request.context,
      environment: { model, credentials, policy },
    });
  }
}
