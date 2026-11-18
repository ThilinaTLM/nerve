import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  bridgeLimits,
  bridgeJsonSchema,
  bridgeProtocolVersion,
  fieldValue,
  themeTokensCss,
  validateBridgeRequest,
  type BridgeContributionKind,
  type BridgeResult,
  type ExtensionResolution,
  type ExtensionUiContributions,
  type ExtensionUiThemes,
  type ServerBridgeMethod,
} from "@nervekit/contracts/extensions";
import {
  callExtensionMethodFromUi,
  ExtensionUiCallError,
} from "@nervekit/tools/quick-script";
import type { AccountsReader } from "../../domains/accounts/accounts.service.js";
import type { ExtensionSettingsService } from "../../infrastructure/configuration/extensions/extension-settings-service.js";
import type {
  ExtensionRegistryProvider,
  ExtensionUiSource,
  InstalledUiExtension,
} from "../extension-catalog/extension-catalog.js";
import { createExtensionPorts } from "../extension-ports.js";
import type { VisionHost } from "../vision-models.js";
import { ExtensionUiError } from "./extension-ui-error.js";
import {
  fileInfo,
  readFileRange,
  writeFileContent,
} from "./project-file-access.js";
import {
  framePath,
  frameFolder,
  readContainedFile,
  type FrameFile,
} from "./frame-files.js";

export const frameUrlPrefix = "/ext-frame";
export const baseCssUrl = `${frameUrlPrefix}/base.css`;

export type ExtensionUiOptions = {
  catalog: ExtensionRegistryProvider & ExtensionUiSource;
  extensions: Pick<ExtensionSettingsService, "resolve">;
  accounts: AccountsReader;
  vision?: VisionHost;
  project(
    projectId: string,
  ): { id: string; name: string; directory: string } | undefined;
  warn?(message: string, data?: unknown): void;
};

type ActiveProject = {
  directory: string;
  resolution: ExtensionResolution;
  extensions: InstalledUiExtension[];
};

type Contribution =
  | {
      kind: "preview";
      edit: "source" | "custom" | "none";
      extensions: readonly string[];
    }
  | { kind: "page" | "panel" };

/** What the open project's installed extensions contribute to the UI, and what their frames may ask of the daemon. */
export class ExtensionUiService {
  readonly #options: ExtensionUiOptions;
  /** Per project: the unguessable part of its frame URLs. Lives as long as the daemon. */
  readonly #tokens = new Map<string, string>();
  readonly #byToken = new Map<string, string>();

  constructor(options: ExtensionUiOptions) {
    this.#options = options;
  }

  // ── Frame URLs ──────────────────────────────────────────────────────────

  #tokenOf(projectId: string): string {
    let token = this.#tokens.get(projectId);
    if (!token) {
      token = randomBytes(32).toString("hex");
      this.#tokens.set(projectId, token);
      this.#byToken.set(token, projectId);
    }
    return token;
  }

  #frameUrl(projectId: string, extensionId: string, contribution: string) {
    return `${frameUrlPrefix}/${this.#tokenOf(projectId)}/${extensionId}/${contribution}/index.html`;
  }

  /** Project of a frame token; the comparison does not leak how much of a token matched. */
  #projectOfToken(token: string): string | undefined {
    const projectId = this.#byToken.get(token);
    if (!projectId) return undefined;
    const expected = Buffer.from(this.#tokens.get(projectId) ?? "");
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given)
      ? projectId
      : undefined;
  }

  // ── What is available ───────────────────────────────────────────────────

  async #resolution(projectId?: string): Promise<ExtensionResolution> {
    return projectId
      ? await this.#options.extensions.resolve(
          { projectId, role: "lead" },
          "project",
        )
      : await this.#options.extensions.resolve({ role: "lead" }, "user");
  }

  /** The loaded installed extensions of a project that the settings switch on. */
  async #active(projectId: string): Promise<ActiveProject> {
    const project = this.#options.project(projectId);
    if (!project)
      throw new ExtensionUiError("not_found", "The project does not exist.");
    // Composing first: the settings definitions of a project's own extensions exist once it is composed.
    const installed = await this.#options.catalog.installedUi(
      project.directory,
    );
    const resolution = await this.#resolution(projectId);
    return {
      directory: project.directory,
      resolution,
      extensions: installed.filter(
        (extension) =>
          resolution.extensions[extension.id]?.enabled.value === true,
      ),
    };
  }

  async contributions(projectId: string): Promise<ExtensionUiContributions> {
    const { extensions } = await this.#active(projectId);
    const base = (
      extension: InstalledUiExtension,
      item: { id: string; label: string },
    ) => ({
      extensionId: extension.id,
      extensionName: extension.name,
      source: extension.source,
      id: item.id,
      label: item.label,
      frameUrl: this.#frameUrl(projectId, extension.id, item.id),
    });
    return {
      baseCssUrl,
      previews: extensions.flatMap((extension) =>
        (extension.ui.previews ?? []).map((preview) => ({
          ...base(extension, preview),
          match: { extensions: [...preview.match.extensions] },
          edit: preview.edit,
        })),
      ),
      pages: extensions.flatMap((extension) =>
        (extension.ui.pages ?? []).map((page) => ({
          ...base(extension, page),
          icon: page.icon,
          newMenu: page.newMenu,
        })),
      ),
      panels: extensions.flatMap((extension) =>
        (extension.ui.panels ?? []).map((panel) => ({
          ...base(extension, panel),
          icon: panel.icon,
        })),
      ),
    };
  }

  /** Themes of the enabled user extensions. App-wide, so project extensions never contribute one. */
  async themes(): Promise<ExtensionUiThemes> {
    const installed = await this.#options.catalog.installedUi();
    const resolution = await this.#resolution();
    return {
      themes: installed
        .filter(
          (extension) =>
            extension.source === "user" &&
            resolution.extensions[extension.id]?.enabled.value === true,
        )
        .flatMap((extension) =>
          extension.themes.map((theme) => ({
            id: `ext:${extension.id}/${theme.id}`,
            extensionId: extension.id,
            extensionName: extension.name,
            label: theme.label,
            kind: theme.kind,
            tokens: theme.tokens,
            tokensCss: themeTokensCss(theme.tokens),
          })),
        ),
    };
  }

  // ── Frame files ─────────────────────────────────────────────────────────

  /**
   * One file of a frame for the daemon's `/ext-frame/<token>/<extension>/<contribution>/…` route.
   * `undefined` (a 404) unless the token names a project, the extension is loaded there and
   * switched on, the contribution is declared in its manifest, and the file is inside
   * `dist/ui/<contribution>/`.
   */
  async frameFile(
    token: string,
    extensionId: string,
    contributionId: string,
    requested: string,
  ): Promise<FrameFile | undefined> {
    const projectId = this.#projectOfToken(token);
    if (!projectId) return undefined;
    const path = framePath(requested);
    if (!path) return undefined;
    let active: ActiveProject;
    try {
      active = await this.#active(projectId);
    } catch {
      return undefined;
    }
    const extension = active.extensions.find(
      (candidate) => candidate.id === extensionId,
    );
    if (!extension || !contributionOf(extension, contributionId))
      return undefined;
    return await readContainedFile(
      frameFolder(extension.dist, contributionId),
      path,
    );
  }

  // ── The bridge ──────────────────────────────────────────────────────────

  /** Answers one bridge request that needs the daemon. Failures are `ExtensionUiError`s. */
  async bridge<M extends ServerBridgeMethod>(
    method: M,
    input: {
      projectId: string;
      extensionId: string;
      contribution: { kind: BridgeContributionKind; id: string };
      filePath?: string | undefined;
      params: unknown;
    },
  ): Promise<BridgeResult<M>> {
    const active = await this.#active(input.projectId);
    const extension = active.extensions.find(
      (candidate) => candidate.id === input.extensionId,
    );
    const contribution =
      extension && contributionOf(extension, input.contribution.id);
    if (
      !extension ||
      !contribution ||
      contribution.kind !== input.contribution.kind
    )
      throw new ExtensionUiError(
        "not_found",
        "That contribution is not available.",
      );
    // The manifest, not the caller, says what a preview may do.
    const checked = validateBridgeRequest(
      {
        nerveBridge: bridgeProtocolVersion,
        type: "request",
        id: "server",
        method,
        params: input.params,
      },
      contribution.kind === "preview"
        ? { kind: "preview", edit: contribution.edit }
        : { kind: contribution.kind },
    );
    if (!checked.ok)
      throw new ExtensionUiError(checked.error.code, checked.error.message);
    const params = checked.params as never;
    const result = await this.#run(method, params, {
      active,
      extension,
      contribution,
      input,
    });
    return result as BridgeResult<M>;
  }

  async #run(
    method: ServerBridgeMethod,
    params: Record<string, unknown>,
    context: {
      active: ActiveProject;
      extension: InstalledUiExtension;
      contribution: Contribution;
      input: {
        projectId: string;
        extensionId: string;
        filePath?: string | undefined;
      };
    },
  ): Promise<unknown> {
    const { active, extension, contribution, input } = context;
    switch (method) {
      case "project.info": {
        const project = this.#options.project(input.projectId)!;
        return {
          id: project.id,
          name: project.name,
          directory: project.directory,
        };
      }
      case "settings.get": {
        const resolved = active.resolution.extensions[extension.id];
        const values: Record<string, unknown> = {};
        for (const key of Object.keys(resolved?.fields ?? {})) {
          const value = fieldValue(resolved, key);
          const json = bridgeJsonSchema.safeParse(value);
          if (value !== undefined && json.success) values[key] = json.data;
        }
        return { values };
      }
      case "file.info":
      case "file.read":
      case "file.write": {
        const filePath = this.#previewFile(contribution, input.filePath);
        if (method === "file.info")
          return await fileInfo(active.directory, filePath);
        if (method === "file.read")
          return await readFileRange(active.directory, filePath, params);
        return await writeFileContent(
          active.directory,
          filePath,
          params.content as string,
          params.encoding as "utf8" | "base64",
        );
      }
      case "call":
        return await this.#call(active, extension, params);
    }
  }

  /** The file a preview was opened on; refuses a file type the preview does not declare. */
  #previewFile(
    contribution: Contribution,
    filePath: string | undefined,
  ): string {
    if (contribution.kind !== "preview")
      throw new ExtensionUiError("not_allowed", "Only previews have a file.");
    if (!filePath)
      throw new ExtensionUiError(
        "invalid_request",
        "This request needs the preview's file path.",
      );
    const lower = filePath.toLowerCase();
    if (!contribution.extensions.some((extension) => lower.endsWith(extension)))
      throw new ExtensionUiError(
        "not_allowed",
        "This preview does not open that file type.",
      );
    return filePath;
  }

  async #call(
    active: ActiveProject,
    extension: InstalledUiExtension,
    params: Record<string, unknown>,
  ): Promise<{ value?: unknown }> {
    const registry = await this.#options.catalog.registryFor(active.directory);
    const ports = createExtensionPorts({
      resolution: active.resolution,
      accounts: this.#options.accounts,
      ...(this.#options.vision ? { vision: this.#options.vision } : {}),
      warn: (id, message, data) =>
        this.#options.warn?.(`${id}: ${message}`, data),
    });
    let value: unknown;
    try {
      value = await callExtensionMethodFromUi({
        registry,
        extensionId: extension.id,
        method: params.method as string,
        ...(params.args !== undefined ? { args: params.args } : {}),
        projectDir: active.directory,
        ports,
      });
    } catch (error) {
      if (error instanceof ExtensionUiCallError)
        throw new ExtensionUiError(error.code, error.message);
      throw error;
    }
    if (value === undefined) return {};
    // Plain JSON only: the bridge carries nothing else.
    let json: unknown;
    try {
      json = JSON.parse(JSON.stringify(value));
    } catch {
      throw new ExtensionUiError(
        "backend_error",
        "The method returned a value that is not JSON.",
      );
    }
    const parsed = bridgeJsonSchema.safeParse(json);
    if (!parsed.success)
      throw new ExtensionUiError(
        "backend_error",
        "The method returned a value that is not JSON.",
      );
    if (
      Buffer.byteLength(JSON.stringify(parsed.data)) >
      bridgeLimits.maxMessageBytes - 1024
    )
      throw new ExtensionUiError(
        "too_large",
        "The method's result is too large to send to the frame.",
      );
    return { value: parsed.data };
  }
}

/** The declared contribution with this id, whatever its kind. */
function contributionOf(
  extension: InstalledUiExtension,
  id: string,
): Contribution | undefined {
  const preview = extension.ui.previews?.find((item) => item.id === id);
  if (preview)
    return {
      kind: "preview",
      edit: preview.edit,
      extensions: preview.match.extensions,
    };
  if (extension.ui.pages?.some((item) => item.id === id))
    return { kind: "page" };
  if (extension.ui.panels?.some((item) => item.id === id))
    return { kind: "panel" };
  return undefined;
}
