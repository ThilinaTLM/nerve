export function makeAck(
  stream: string,
  processedSeq: number,
): { type: "ack"; stream: string; processedSeq: number } {
  return { type: "ack", stream, processedSeq };
}
