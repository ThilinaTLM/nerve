import type { ManagerState } from "../app/manager-state.js";

export const MANAGER_EVENT_STORE_ID = "__manager__";
export const MANAGER_EVENT_STREAM = "manager";

export type ManagerLifecycleEventInput = {
  type: string;
  sandboxId?: string;
  payload?: unknown;
  ts?: string;
};

export async function recordManagerLifecycleEvent(
  state: ManagerState,
  event: ManagerLifecycleEventInput,
): Promise<void> {
  await state.eventJournal.publish(event);
}
