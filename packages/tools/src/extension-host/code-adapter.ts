/* eslint-disable @typescript-eslint/no-explicit-any -- method tables hold methods of different session and input types */
import {
  type AccountInfo,
  type AccountTestResult,
  type Authorization,
  type AuthorizeResult,
  type Availability,
  type ExtensionContext,
  type ExtensionDefinition,
  type MethodDefinition,
  type NamespaceDefinition,
  type OwnToolDefinition,
  type Risk,
} from "@nervekit/extension-api";
import { isMethodTool } from "@nervekit/extension-api/host";
import { accountTestContext, hookContext } from "./hook-context.js";

/**
 * How the host talks to an extension's code. Every operation is asynchronous
 * and exchanges plain data (JSON-compatible values), so the code can run in
 * the host process (`InProcessExtensionCodeAdapter`) or in a sandboxed
 * runtime on the other side of a message boundary. The host never holds a
 * function, a class instance or a session of extension code.
 */

/** The method or direct tool an operation is about. */
export type CodeTarget =
  | { kind: "method"; namespace: string; path: string }
  /** A direct tool with its own implementation. */
  | { kind: "tool"; name: string };

/** The call a `run` serves: names the operation and bounds `ctx.authorize` to its declared risk. */
export type CodeCall = { name: string; risk: Risk };

/** What the agent reads and what each view section renders, for a direct tool's output. */
export type CodePresentation = {
  text: string;
  sections?: Record<string, unknown>;
  details?: { query?: string; answer?: string };
};

/** What an availability hook belongs to. */
export type AvailabilityTarget =
  | { kind: "namespace"; id: string }
  | { kind: "tool"; name: string };

/** One extension's code, opened for one run. */
export interface ExtensionCode {
  /** Validates the script's arguments; returns the parsed input (plain data) or throws. Pure: no I/O. */
  parse(target: CodeTarget, args: unknown[]): Promise<unknown>;
  /** What the call is authorized as, for the parsed input. Pure: no I/O, completes before any I/O of the call. */
  authorize(target: CodeTarget, input: unknown): Promise<Authorization[]>;
  /** What a 403 refers to; undefined when the method declares none. */
  resource(target: CodeTarget, input: unknown): Promise<string | undefined>;
  /**
   * Runs the call. A namespace's session (clients, caches) is opened on the
   * first run in the extension and kept inside the code until `dispose`: it is
   * not plain data and never crosses this interface. Failures reject.
   */
  run(target: CodeTarget, input: unknown, call: CodeCall): Promise<unknown>;
  /** Splits a direct tool's output for the agent and the tool card; undefined when the tool has no `present`. */
  present(tool: string, output: unknown): Promise<CodePresentation | undefined>;
  /** The line `sdk.describe` prints about how a namespace is configured now. */
  configuration(namespace: string): Promise<string | undefined>;
  /** The verdict of a namespace's or tool's own availability hook; undefined when it has none. */
  availability(target: AvailabilityTarget): Promise<Availability | undefined>;
  /** The Settings "Test" of an account kind, with a `ctx` bound to that account by the host. */
  testAccount(kind: string, account: AccountInfo): Promise<AccountTestResult>;
  /** Ends the run of this code: releases its sessions and, for a sandbox, its runtime. Idempotent. */
  dispose(): Promise<void>;
}

/** What the host gives code it opens: the `ctx` of the extension, served by the host. */
export type ExtensionCodeHost = {
  /** The extension's `ctx`; inside a call (`call`) `ctx.authorize` is bound to the call's declared risk. */
  context(call?: CodeCall): ExtensionContext;
  /** The run's cancellation: a sandbox cancels its invocations natively when it aborts. */
  signal: AbortSignal;
};

/**
 * Opens an extension's code for one run: a persistent runtime per extension
 * per run (a sandbox adapter evaluates the extension bundle on `open` or on
 * the first call and keeps it until `dispose`). The host calls `open` lazily,
 * on the first call into the extension of a run, and `dispose` when the run
 * ends. Runtimes are never shared between runs.
 */
export interface ExtensionCodeAdapter {
  open(
    definition: ExtensionDefinition,
    host: ExtensionCodeHost,
  ): Promise<ExtensionCode> | ExtensionCode;
}

const asArray = (result: AuthorizeResult): Authorization[] =>
  result === undefined
    ? []
    : Array.isArray(result)
      ? [...(result as readonly Authorization[])]
      : [result as Authorization];

/** Today's behaviour: the definitions run in the host process. */
export const inProcessExtensionCode: ExtensionCodeAdapter = {
  open: (definition, host) => new InProcessExtensionCode(definition, host),
};

class InProcessExtensionCode implements ExtensionCode {
  readonly #sessions = new Map<string, Promise<unknown>>();

  constructor(
    private readonly definition: ExtensionDefinition,
    private readonly host: ExtensionCodeHost,
  ) {}

  #namespace(id: string): NamespaceDefinition<any> {
    const namespace = this.definition.namespaces.find(
      (candidate) => candidate.id === id,
    );
    if (!namespace)
      throw new Error(`${this.definition.id}: unknown namespace ${id}.`);
    return namespace;
  }

  #method(
    target: CodeTarget & { kind: "method" },
  ): MethodDefinition<any, any, any> {
    const method = this.#namespace(target.namespace).methods[target.path];
    if (!method)
      throw new Error(
        `${this.definition.id}: unknown method ${target.namespace}.${target.path}.`,
      );
    return method;
  }

  #tool(name: string): OwnToolDefinition {
    const tool = this.definition.tools?.find(
      (candidate) => candidate.name === name,
    );
    if (!tool || isMethodTool(tool))
      throw new Error(`${this.definition.id}: unknown tool ${name}.`);
    return tool;
  }

  async parse(target: CodeTarget, args: unknown[]): Promise<unknown> {
    return target.kind === "method"
      ? this.#method(target).parse(args)
      : this.#tool(target.name).parse(
          (args[0] ?? {}) as Record<string, unknown>,
        );
  }

  async authorize(
    target: CodeTarget,
    input: unknown,
  ): Promise<Authorization[]> {
    const definition =
      target.kind === "method" ? this.#method(target) : this.#tool(target.name);
    return asArray(definition.authorize?.(input));
  }

  async resource(
    target: CodeTarget,
    input: unknown,
  ): Promise<string | undefined> {
    return target.kind === "method"
      ? this.#method(target).resource?.(input)
      : undefined;
  }

  async run(
    target: CodeTarget,
    input: unknown,
    call: CodeCall,
  ): Promise<unknown> {
    const ctx = this.host.context(call);
    if (target.kind === "tool")
      return await this.#tool(target.name).run(input, ctx);
    const namespace = this.#namespace(target.namespace);
    const session = await this.#session(namespace);
    return await this.#method(target).run(session, input, ctx);
  }

  #session(namespace: NamespaceDefinition<any>): Promise<unknown> {
    let session = this.#sessions.get(namespace.id);
    if (!session) {
      session = Promise.resolve().then(() =>
        namespace.session?.(this.host.context()),
      );
      this.#sessions.set(namespace.id, session);
    }
    return session;
  }

  async present(
    tool: string,
    output: unknown,
  ): Promise<CodePresentation | undefined> {
    const definition = this.definition.tools?.find(
      (candidate) => candidate.name === tool,
    );
    if (!definition)
      throw new Error(`${this.definition.id}: unknown tool ${tool}.`);
    return (
      definition as { present?(output: unknown): CodePresentation }
    ).present?.(output);
  }

  async configuration(namespace: string): Promise<string | undefined> {
    return this.#namespace(namespace).configuration?.(
      hookContext(this.host.context()),
    );
  }

  async availability(
    target: AvailabilityTarget,
  ): Promise<Availability | undefined> {
    const hook =
      target.kind === "namespace"
        ? this.#namespace(target.id).availability
        : this.definition.tools?.find((tool) => tool.name === target.name)
            ?.availability;
    return await hook?.(hookContext(this.host.context()));
  }

  async testAccount(
    kind: string,
    account: AccountInfo,
  ): Promise<AccountTestResult> {
    const test = this.definition.accounts?.[kind]?.test;
    if (!test)
      throw new Error(
        `${this.definition.id}: account kind ${kind} has no test.`,
      );
    return await test(account, accountTestContext(this.host.context()));
  }

  async dispose(): Promise<void> {
    this.#sessions.clear();
  }
}
