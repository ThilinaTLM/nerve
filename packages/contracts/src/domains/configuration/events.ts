import { z } from "zod";
import { definePublicEvent } from "../../events/definition.js";
import { trustStateSchema } from "../core/trust-state.js";
import { configurationReviewTargetSchema } from "./review.js";

export const configurationDecidedEventSchema = z.strictObject({
  target: configurationReviewTargetSchema,
  /** The item's state after the decision. */
  state: trustStateSchema,
});
export type ConfigurationDecidedEvent = z.infer<
  typeof configurationDecidedEventSchema
>;

export const configurationEventDefinitions = [
  /** The user decided on an item (`configuration.decide`); every window refreshes what shows it. */
  definePublicEvent("configuration.decided", configurationDecidedEventSchema, {
    allowedSourceRoles: ["workbench_server"],
  }),
];
