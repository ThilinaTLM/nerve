/** Drops a turn's ephemeral assistant/thinking/tool-draft blocks when the
 * provider request restarts; other turns keep their drafts. */
export function resetLiveTurnBlocks<T extends { turnId: string }>(
  blocks: readonly T[],
  turnId: string,
): T[] {
  return blocks.filter((block) => block.turnId !== turnId);
}
