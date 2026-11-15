import { z } from "zod";
/** A live output stream: `stdout`, `stderr` or `combined` of a process, or the live view section of an extension tool. */
export const toolOutputStreamSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/);
export type ToolOutputStream = z.infer<typeof toolOutputStreamSchema>;
