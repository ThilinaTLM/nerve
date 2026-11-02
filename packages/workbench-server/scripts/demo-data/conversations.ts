export type {
  DemoBranch,
  DemoConversation,
  DemoStep,
} from "./conversation-types.js";
import type { DemoConversation } from "./conversation-types.js";
import {
  designTokens,
  failedMigration,
  flakyDeploy,
  limiterStrategies,
  planning,
  rateLimiting,
  runningBackfill,
  shortConversations,
} from "./aurora-conversations.js";
import { northstarConversations } from "./northstar-conversations.js";
import { relayboardConversations } from "./relayboard-conversations.js";

export const DEMO_PROJECT_CONVERSATIONS: Readonly<
  Record<string, readonly DemoConversation[]>
> = {
  aurora: [
    rateLimiting,
    {
      title: "Choose the booking limiter rollout",
      agentProfile: "coding",
      permissionRuleSetId: "supervised",
      ageHours: 1,
      steps: [
        {
          type: "user",
          text: "Help me choose a safe rollout for the new booking limiter.",
        },
        {
          type: "assistant",
          text: "The focused tests pass. Before changing deployment settings, choose how broadly to enable the limiter.",
        },
      ],
      references: [
        {
          kind: "pull_request",
          repository: "aurora-demo/aurora-api",
          number: 42,
          relationship: "referenced",
        },
      ],
      question: {
        question: "How should we roll out the booking limiter?",
        options: [
          {
            label: "Staging first",
            description:
              "Verify rejected requests and burst capacity before production.",
            recommended: true,
          },
          {
            label: "One production replica",
            description: "Start with a small canary and watch booking errors.",
          },
          {
            label: "Prepare a rollout plan",
            description:
              "Review monitoring and rollback steps before deploying.",
          },
        ],
      },
    },
    runningBackfill,
    limiterStrategies,
    failedMigration,
    flakyDeploy,
    planning,
    designTokens,
    ...shortConversations,
  ],
  northstar: northstarConversations,
  relayboard: relayboardConversations,
};
