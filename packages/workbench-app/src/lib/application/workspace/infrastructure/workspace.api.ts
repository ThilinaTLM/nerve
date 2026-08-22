import type { WorkspaceSnapshotResponse } from "@nervekit/contracts";
import { protocolRequest } from "@nervekit/protocol";

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshotResponse> {
  const { result: response } = await protocolRequest(
    "snapshot.workspace.get",
    {},
  );
  return {
    ...response,
    snapshot: {
      ...response.snapshot,
      conversations: [...response.snapshot.conversations].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    },
  };
}
