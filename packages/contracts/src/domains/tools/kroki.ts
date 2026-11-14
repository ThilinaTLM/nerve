import { z } from "zod";

/** A Kroki diagram engine name (`mermaid`, `plantuml`, …). */
export const krokiDiagramTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/);
