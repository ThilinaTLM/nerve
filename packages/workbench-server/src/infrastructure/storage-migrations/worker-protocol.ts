import type {
  HomeMigrationApproval,
  HomeMigrationPlan,
  HomeMigrationProgress,
  HomeMigrationResult,
} from "@nervekit/contracts/storage";

export type StorageMigrationWorkerRequest =
  | { operation: "inspect"; home: string }
  | {
      operation: "apply";
      home: string;
      plan: HomeMigrationPlan;
      approval: HomeMigrationApproval;
    };

export type StorageMigrationWorkerResult =
  | { operation: "inspect"; value: HomeMigrationPlan }
  | { operation: "apply"; value: HomeMigrationResult };

export type StorageMigrationWorkerResponse =
  | { type: "progress"; progress: HomeMigrationProgress }
  | { type: "success"; result: StorageMigrationWorkerResult }
  | {
      type: "failure";
      error: {
        name: string;
        message: string;
        stack?: string;
        code?: string;
        quarantineIds?: string[];
      };
    };
