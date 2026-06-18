export type VoiceInputTarget =
  | { kind: "conversation"; id: string }
  | { kind: "pending-conversation"; id: string }
  | { kind: "ask-user"; id: string };

export function voiceInputTargetKey(target: VoiceInputTarget): string {
  return `${target.kind}:${target.id}`;
}

export function voiceInputTargetsEqual(
  left: VoiceInputTarget | undefined,
  right: VoiceInputTarget | undefined,
): boolean {
  return Boolean(
    left && right && left.kind === right.kind && left.id === right.id,
  );
}

export function appendTranscriptText(
  current: string,
  transcript: string,
): string {
  const trimmed = transcript.trim();
  if (!trimmed) return current;
  const separator = current.trim() ? (/\s$/.test(current) ? "" : "\n\n") : "";
  return `${current}${separator}${trimmed}`;
}
