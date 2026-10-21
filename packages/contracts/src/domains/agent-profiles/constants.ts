import { z } from "zod";

export const AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES = 16 * 1024;
export const builtInAgentProfileNames = [
  "coding",
  "planning",
  "explore",
  "developer",
] as const;
export type BuiltInAgentProfileName = (typeof builtInAgentProfileNames)[number];
export const DEFAULT_AGENT_PROFILE = "coding";

export const AGENT_PROFILE_NAME_MAX_LENGTH = 32;
export const AGENT_PROFILE_LABEL_MAX_LENGTH = 80;
export const AGENT_PROFILE_DESCRIPTION_MAX_LENGTH = 200;

export const agentProfileNameSchema = z
  .string()
  .min(1)
  .max(AGENT_PROFILE_NAME_MAX_LENGTH)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "Name must use lowercase letters, numbers, and single hyphens",
  );
export type AgentProfileName = z.infer<typeof agentProfileNameSchema>;

/** UTF-8 byte length, the unit of the instruction limit. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Instructions text for a profile or a conversation, bounded by UTF-8 bytes. */
export const agentProfileInstructionsSchema = z
  .string()
  .refine(
    (value) => utf8ByteLength(value) <= AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES,
    {
      message: `Instructions must be at most ${AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES} bytes`,
    },
  );
