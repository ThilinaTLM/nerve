import { image } from "@nervekit/native";
import type {
  AccountInfo,
  ArtifactInfo,
  ArtifactRef,
  ExtensionContext,
  ExtensionDefinition,
  Risk,
} from "@nervekit/extension-api";
import { accountFieldKinds } from "@nervekit/contracts/extensions";
import { ExtensionError } from "@nervekit/extension-api";
import {
  isolatedHtmlToMarkdown,
  resolveToolPath,
} from "../../execution/index.js";
import {
  artifactTempPath,
  commitArtifact,
  freshArtifactName,
  MAX_ATTACHMENT_BYTES,
  MAX_FILE_BYTES,
  mediaTypeFor,
  parseHandle,
  readFileRef,
  statFileRef,
  writeArtifact,
} from "../runtime/files/artifacts.js";
import type { SdkEnvironment } from "../runtime/sdk-types.js";
import { assertDeclaredRisk } from "../runtime/script-risk.js";
import { inProcessExtensionCode, type ExtensionCode } from "./code-adapter.js";
import { createHttp } from "./http.js";

/**
 * The per-run side of the extension API: builds each extension's `ctx` through
 * the host ports (lazily, once per extension) and opens each extension's code (and with it
 * the namespace sessions, created on first use). One instance per `quick_script` run.
 */
export class ExtensionRuntime {
  readonly #contexts = new Map<string, ExtensionContext>();
  readonly #code = new Map<string, Promise<ExtensionCode>>();
  /** Workspace files the run is allowed to read through `ctx.artifacts.read`: paths whose `read` check passed. */
  readonly #authorizedReads = new Set<string>();

  constructor(private readonly env: SdkEnvironment) {}

  /** Called after a call's checks passed: its `read` authorizations open those files to `ctx.artifacts.read`. */
  allowReads(paths: readonly string[]): void {
    for (const path of paths)
      this.#authorizedReads.add(resolveToolPath(this.env.context.cwd, path));
  }

  /**
   * The extension's code for this run, opened on first use through the host's
   * adapter (in-process unless the host composed another) and kept until `dispose`.
   */
  code(definition: ExtensionDefinition): Promise<ExtensionCode> {
    let code = this.#code.get(definition.id);
    if (!code) {
      const adapter =
        this.env.context.extensionCodeAdapter ??
        this.env.registry.extensionCodeAdapter ??
        inProcessExtensionCode;
      code = Promise.resolve(
        adapter.open(definition, {
          context: (call) => this.context(definition, call),
        }),
      );
      this.#code.set(definition.id, code);
    }
    return code;
  }

  /** Ends the run's extension code (sessions, sandbox runtimes). Safe to call more than once. */
  async dispose(): Promise<void> {
    const opened = [...this.#code.values()];
    this.#code.clear();
    await Promise.all(
      opened.map(async (code) => {
        try {
          await (await code).dispose();
        } catch {
          // Nothing left to release; the run's result does not depend on it.
        }
      }),
    );
  }

  /**
   * The extension's `ctx`. Inside a method call (`call`) `ctx.authorize` is
   * bound to that call's declared risk; elsewhere it is unavailable.
   */
  context(
    definition: ExtensionDefinition,
    call?: { name: string; risk: Risk },
  ): ExtensionContext {
    let ctx = this.#contexts.get(definition.id);
    if (!ctx) {
      ctx = this.#build(definition);
      this.#contexts.set(definition.id, ctx);
    }
    if (!call) return ctx;
    return {
      ...ctx,
      authorize: async (check) => {
        // The invariant of the script scan: a call never checks above its declared risk.
        try {
          assertDeclaredRisk(call.name, call.risk, [
            { ...check, targets: [], summary: "" },
          ]);
        } catch (error) {
          throw new ExtensionError(
            "BAD_REQUEST",
            error instanceof Error ? error.message : String(error),
          );
        }
        // The same path as the checks declared in `authorize`: policy, then the script's admission.
        await this.#authorizeNested(check);
      },
    };
  }

  async #authorizeNested(check: {
    operation: string;
    targets: readonly string[];
    risk: Risk;
  }): Promise<void> {
    const authorizeNested = this.env.context.authorizeNested;
    if (!authorizeNested)
      throw new ExtensionError(
        "DENIED",
        "Nested authorization is unavailable; refusing to run SDK calls.",
      );
    await authorizeNested({
      operation: check.operation,
      targets: [...check.targets],
      risk: check.risk,
    });
  }

  #build(definition: ExtensionDefinition): ExtensionContext {
    const { env } = this;
    const ports = env.context.extensionPorts;
    if (!ports)
      throw new Error("Extensions are not available in this context.");
    const settings = ports.settings(definition.id);
    const selected = async (
      field: string,
    ): Promise<AccountInfo | undefined> => {
      const declared = definition.settings.fields[field];
      const id = settings[field];
      if (declared?.type !== "account" || typeof id !== "string" || !id)
        return undefined;
      for (const kind of accountFieldKinds(declared)) {
        const account = await ports.accounts.get(kind, id);
        if (account) return account;
      }
      return undefined;
    };
    const signal = env.context.signal ?? new AbortController().signal;
    const readWorkspaceOrArtifact = async (handle: string) => {
      const ref = parseHandle(handle, env);
      if (ref.kind === "workspace" && !this.#authorizedReads.has(ref.path))
        throw new ExtensionError(
          "DENIED",
          `${handle}: reading this file was not authorized for the call; declare it in authorize() as a read.`,
        );
      return ref;
    };
    const reported = (handle: string): ArtifactRef => {
      const entry = env.report.artifacts.get(handle)!;
      return {
        handle,
        name: handle.slice("artifact:".length),
        bytes: entry.bytes,
        mediaType: entry.mediaType,
      };
    };
    const accountFieldNames = Object.entries(definition.settings.fields)
      .filter(([, field]) => field.type === "account")
      .map(([name]) => name);
    const http = createHttp({
      extensionName: definition.name,
      network: definition.permissions?.network ?? [],
      kinds: Object.fromEntries(
        Object.entries(definition.accounts ?? {}).map(([kind, def]) => [
          kind,
          { label: def.label, auth: def.auth, origins: def.origins },
        ]),
      ),
      kindsOfField: (field) => {
        const declared = definition.settings.fields[field];
        return declared?.type === "account" ? accountFieldKinds(declared) : [];
      },
      settings,
      selected,
      allSelected: async () =>
        (await Promise.all(accountFieldNames.map(selected))).filter(
          (account): account is AccountInfo => account !== undefined,
        ),
      secret: (kind, id) => ports.accounts.secret(kind, id),
      signal,
      allowPrivateNetwork: env.context.webFetchPolicy?.allowPrivateNetwork,
      openHandle: async (handle) => {
        const ref = await readWorkspaceOrArtifact(handle);
        const size = await statFileRef(
          ref,
          MAX_ATTACHMENT_BYTES,
          "Split or compress it.",
        );
        return { path: ref.path, size };
      },
      artifactSink: () => ({
        prepare: () => artifactTempPath(env),
        freshName: (base, extension) => freshArtifactName(env, base, extension),
        commit: async (path, name) =>
          reported(await commitArtifact(env, path, name)),
      }),
    });
    const generateImage = ports.generateImage;
    const explainImage = ports.explainImage;
    const visionReady = ports.visionReady;
    const progress = (section: string, chunk: string) => {
      if (!env.context.toolProgress?.(section, chunk))
        ports.log?.(
          "warn",
          definition.id,
          `ctx.progress: '${section}' is not a live section of the running tool; ignored.`,
        );
    };
    return {
      settings: { get: <T>(key: string) => settings[key] as T | undefined },
      accounts: { selected },
      http,
      artifacts: {
        write: async (name, data, mediaType) => {
          const bytes =
            typeof data === "string" ? new TextEncoder().encode(data) : data;
          const handle = await writeArtifact(env, name, bytes);
          if (mediaType)
            env.report.artifacts.get(handle)!.mediaType = mediaType;
          return reported(handle);
        },
        read: async (handle) => {
          const ref = await readWorkspaceOrArtifact(handle);
          const bytes = await readFileRef(ref);
          return {
            bytes: new Uint8Array(bytes),
            mediaType: mediaTypeFor(ref.path),
            name:
              ref.kind === "artifact" ? ref.name : ref.path.split("/").pop()!,
          };
        },
        info: async (handle): Promise<ArtifactInfo> => {
          const ref = await readWorkspaceOrArtifact(handle);
          // Size up to the transfer limit (uploads stream); dimensions only for files the host reads.
          const bytes = await statFileRef(
            ref,
            MAX_ATTACHMENT_BYTES,
            "Split or compress it.",
          );
          const mediaType = mediaTypeFor(ref.path);
          const dimensions =
            bytes <= MAX_FILE_BYTES &&
            (mediaType === "image/png" || mediaType === "image/jpeg")
              ? await readFileRef(ref)
                  .then((data) => image.imageInfo(data))
                  .then((info) => ({ width: info.width, height: info.height }))
                  .catch(() => ({}))
              : {};
          return {
            handle,
            name:
              ref.kind === "artifact" ? ref.name : ref.path.split("/").pop()!,
            bytes,
            mediaType,
            ...dimensions,
          };
        },
        freshName: (base, extension) => freshArtifactName(env, base, extension),
      },
      text: {
        htmlToMarkdown: (html) => isolatedHtmlToMarkdown(html, { signal }),
      },
      authorize: async () => {
        throw new ExtensionError(
          "DENIED",
          "ctx.authorize is only available inside a method call.",
        );
      },
      report: {
        created: (entry) => void env.report.created.push(entry),
        updated: (entry) => void env.report.updated.push(entry),
        deleted: (entry) => void env.report.deleted.push(entry),
        note: (text) => void env.report.notes.push(text),
      },
      models: {
        ...(generateImage &&
        definition.permissions?.capabilities?.includes("models.image")
          ? {
              image: {
                generate: async (request) =>
                  await generateImage({
                    prompt: request.prompt,
                    inputs: [...request.inputs],
                    options: request.options,
                    signal,
                  }),
              },
            }
          : {}),
        ...(explainImage &&
        visionReady &&
        definition.permissions?.capabilities?.includes("models.vision")
          ? {
              vision: {
                explain: async (request) =>
                  await explainImage({
                    extensionId: definition.id,
                    image: request.image,
                    ...(request.prompt !== undefined
                      ? { prompt: request.prompt }
                      : {}),
                    onDelta: ({ kind, delta }) => {
                      const section =
                        kind === "thinking"
                          ? request.progress?.thinking
                          : request.progress?.text;
                      if (section) progress(section, delta);
                    },
                    signal,
                  }),
                ready: async () => await visionReady(definition.id),
              },
            }
          : {}),
      },
      progress,
      signal,
      log: {
        debug: (message, data) =>
          ports.log?.("debug", definition.id, message, data),
        warn: (message, data) =>
          ports.log?.("warn", definition.id, message, data),
      },
    };
  }
}
