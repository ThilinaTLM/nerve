import type {
  ApplicationLogLevel,
  ApplicationLogRecord,
  ApplicationLogSource,
} from "@nervekit/contracts";

export type LogsLevelFilter = ApplicationLogLevel | "all";
export type LogsSourceFilter = ApplicationLogSource | "all";

export type LogsPaneModel = {
  rows: ApplicationLogRecord[];
  level: LogsLevelFilter;
  source: LogsSourceFilter;
  component: string;
  contains: string;
  loading: boolean;
  pruning: boolean;
  error?: string;
  notice?: string;
  filtersActive: boolean;
  pruneDescription: string;
};

export type LogsPaneActions = {
  onLevelChange: (value: LogsLevelFilter) => void;
  onSourceChange: (value: LogsSourceFilter) => void;
  onComponentChange: (value: string) => void;
  onContainsChange: (value: string) => void;
  onClearFilters: () => void;
  onRefresh: () => void | Promise<void>;
  onCopy: () => void | Promise<void>;
  onPrune: () => boolean | Promise<boolean>;
};
