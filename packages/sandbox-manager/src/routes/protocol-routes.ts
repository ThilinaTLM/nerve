import type { ManagerState } from "../app/manager-state.js";
export async function getReplay(
  state: ManagerState,
  sandboxId: string,
  afterSeq = 0,
) {
  return (await state.events.list(sandboxId)).filter(
    (event) => (event.seq ?? 0) > afterSeq,
  );
}
