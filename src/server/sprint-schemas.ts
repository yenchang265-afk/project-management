/* Request schemas for the sprint routes. Kept out of the route files so unit
   tests can import them without dragging in next/headers via withAuth. */
import { z } from "zod";

/** Plain calendar date — matches the DATE columns; no time component. */
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const CreateSprintSchema = z.object({
  name: z.string().min(2).max(120),
  start: DateStr.nullable().optional(),
  end: DateStr.nullable().optional(),
}).strict();

export const PatchSprintSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  start: DateStr.nullable().optional(),
  end: DateStr.nullable().optional(),
  state: z.enum(["future", "active", "closed"]).optional(),
}).strict().refine((p) => Object.keys(p).length > 0, { message: "Empty patch" });

export type CreateSprintBody = z.infer<typeof CreateSprintSchema>;
export type PatchSprintBody = z.infer<typeof PatchSprintSchema>;
