import type { Node } from "@xyflow/svelte";
import type { EventTreeNode } from "@nervekit/contracts/core";
export type HistoryNode = Node<
  {
    event?: EventTreeNode;
    active: boolean;
    onSelect?: (id: string | null) => void;
    disabled?: boolean;
  },
  "history"
>;
