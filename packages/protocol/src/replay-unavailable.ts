import type {
  NerveMessage,
  ProtocolV1Message,
  ReplayUnavailableData,
} from "@nervekit/contracts";
import type { MessageFactory } from "./messages.js";

export async function sendReplayUnavailable(options: {
  createMessage: MessageFactory;
  send: (message: NerveMessage) => void | Promise<void>;
  sessionId: string;
  request: ProtocolV1Message & { kind: "replay.request" };
  range: { stream: string; fromSeq: number; latestSeq: number };
  reason: ReplayUnavailableData["streams"][number]["reason"];
  earliestAvailableSeq?: number;
  latestSeq?: number;
  recovery?: ReplayUnavailableData["recovery"];
}): Promise<void> {
  await options.send(
    options.createMessage(
      "replay.unavailable",
      {
        sessionId: options.sessionId,
        replayId: options.request.data.replayId,
        streams: [
          {
            stream: options.range.stream,
            requestedFromSeq: options.range.fromSeq,
            earliestAvailableSeq: options.earliestAvailableSeq,
            latestSeq: options.latestSeq ?? options.range.latestSeq,
            reason: options.reason,
          },
        ],
        recovery: options.recovery ?? { action: "load_snapshot" },
      },
      { target: options.request.source },
    ),
  );
}
