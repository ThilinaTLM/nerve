export const NERVE_PROTOCOL_NAME = "nerve" as const;
export const NERVE_PROTOCOL_VERSION = 1 as const;
export { type IdFactory, createTransportId } from "./runtime/ids.js";
export {
  type MessageFactory,
  type MessageFactoryDependencies,
  type MessageFactoryOptions,
  createMessageFactory,
} from "./messages/message-factory.js";
export {
  type ProtocolClock,
  type ProtocolDiagnosticsPublisher,
  type ProtocolIdSource,
  type ProtocolTimers,
  type ProtocolTransportFactory,
  type StreamReadResult,
  type StreamReader,
} from "./runtime/ports.js";
export {
  systemProtocolClock,
  systemProtocolIds,
  systemProtocolTimers,
} from "./runtime/system-runtime.js";
export { SessionStateError } from "./runtime/session-errors.js";
export {
  type DecodeFailureCode,
  ProtocolCodec,
  type ProtocolCodecOptions,
  ProtocolDecodeError,
} from "./transports/codec.js";
export {
  ProtocolConnection,
  type ProtocolConnectionOptions,
  type ProtocolReceiveContext,
} from "./connections/protocol-connection.js";
export {
  type TransportClose,
  type TransportConnection,
  type TransportFactory,
  type TransportState,
} from "./transports/transport.js";
