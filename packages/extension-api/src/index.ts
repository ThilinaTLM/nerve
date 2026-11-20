/** The public author surface; the SDK re-exports it. Host-only names live in `./host.ts`. */
export type {
  Risk,
  OperationTarget,
  OperationAuthorization,
  ToolAuthorization,
  Authorization,
  AuthorizeResult,
} from "./authorization.js";
export type {
  SettingScope,
  SettingField,
  SettingsSchema,
  ExtensionSettings,
  AccountAuth,
  AccountInfo,
  AccountTestResult,
  AccountKindData,
  AccountKind,
} from "./settings.js";
export type {
  ArtifactRef,
  ArtifactInfo,
  FormPart,
  HttpRequest,
  HttpArtifactOptions,
  HttpResponse,
  ReportEntry,
  ImageOptions,
  ImageRequest,
  ImageResult,
  VisionRequest,
  VisionResult,
  VisionExplainRequest,
  ExtensionContext,
} from "./types.js";
export { ExtensionError } from "./errors.js";
export type { ExtensionErrorCode } from "./errors.js";
export type {
  MethodDefinition,
  Availability,
  DocTopic,
  Requires,
  NamespaceDefinition,
  ViewSectionType,
  ViewSection,
  ToolView,
  JsonSchemaObject,
  MethodToolDefinition,
  OwnToolDefinition,
  ToolDefinition,
  Capability,
  ExtensionPermissions,
  PreviewEditMode,
  PreviewContribution,
  PageContribution,
  PanelContribution,
  ThemeContribution,
  ExtensionUi,
  ExtensionDefinition,
} from "./definition.js";
export {
  defineExtension,
  defineNamespace,
  method,
  defineTool,
} from "./define.js";
