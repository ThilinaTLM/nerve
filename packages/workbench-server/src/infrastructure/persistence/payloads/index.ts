export {
  assertNamespaceReferencesCovered,
  assertPayloadDescriptorCoverage,
  decodeCanonicalPayloadRecords,
  inspectPayloadDescriptorCoverage,
  iterateCanonicalPayloadRecords,
  unregisteredNamespaceReferences,
  type CanonicalPayloadDecodeResult,
  type CanonicalPayloadRecord,
  type PayloadDescriptorCoverage,
} from "./canonical-sweep.js";
export {
  createConfigurationCodec,
  mergeMissingDefaults,
  projectKnownFields,
  type ConfigurationCodec,
  type ConfigurationCodecOptions,
} from "./config-codec.js";
export {
  createJsonPayloadCodec,
  readPreservingUnknown,
  UnsupportedPayloadVersionError,
  upgradePayload,
  type EncodedPayload,
  type JsonPayloadCodecOptions,
  type PayloadCodec,
  type PayloadUpgradeContext,
  type PayloadUpgrader,
  type PayloadUpgraderChain,
} from "./codec.js";
export {
  DOMAIN_DOCUMENT_NAMESPACES,
  PAYLOAD_DESCRIPTORS,
  payloadDescriptor,
  resolvePayloadDescriptor,
  type DomainDocumentNamespace,
  type PayloadDescriptorLookup,
  type PayloadDatabase,
  type PayloadDescriptor,
  type PayloadLocation,
  type PayloadQuarantineUnit,
  type PayloadRecordClass,
  type PayloadVersionSource,
} from "./descriptors.js";
export {
  isJsonObject,
  mergeParsedWithRaw,
  mergePreservingUnknown,
  type JsonObject,
} from "./merge.js";
