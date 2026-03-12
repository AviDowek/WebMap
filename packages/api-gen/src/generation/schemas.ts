/**
 * Zod schemas for validating LLM-generated API function definitions.
 */

import { z } from "zod";

/** Schema for a single action step */
export const ActionStepSchema = z.object({
  type: z.enum(["click", "fill", "select", "key", "scroll", "wait", "goto", "hover", "fetch"]),
  selector: z.string().optional(),
  value: z.string().optional(),
  request: z.object({
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
    urlPattern: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    bodyTemplate: z.string().optional(),
    contentType: z.string().optional(),
  }).optional(),
  timeout: z.number().optional(),
  description: z.string().optional(),
});

/** Schema for action parameters */
export const ActionParamSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "select"]),
  description: z.string(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  testDefault: z.string().optional(),
  pattern: z.string().optional(),
});

/** Schema for expected results */
export const ExpectedResultSchema = z.object({
  description: z.string().min(5),
  urlChange: z.string().optional(),
  a11yDiff: z.object({
    shouldAppear: z.array(z.string()).optional(),
    shouldDisappear: z.array(z.string()).optional(),
  }).optional(),
  expectedResponse: z.object({
    status: z.number(),
    bodyContains: z.string().optional(),
  }).optional(),
});

/** Schema for a single enriched action from LLM */
export const EnrichedActionSchema = z.object({
  name: z.string().min(3),
  description: z.string().min(10),
  expectedResult: ExpectedResultSchema,
  /** Additional steps the LLM thinks are needed (e.g., wait for modal) */
  additionalSteps: z.array(ActionStepSchema).optional(),
});

/** Schema for composite/workflow actions the LLM discovers */
export const CompositeActionSchema = z.object({
  name: z.string().min(3),
  description: z.string().min(10),
  steps: z.array(ActionStepSchema).min(2),
  params: z.array(ActionParamSchema),
  expectedResult: ExpectedResultSchema,
});

/** Schema for the full LLM enrichment response per page */
export const PageEnrichmentResponseSchema = z.object({
  /** Enrichments for existing element-based actions */
  enrichedActions: z.array(EnrichedActionSchema),
  /** New composite/workflow actions discovered by the LLM */
  compositeActions: z.array(CompositeActionSchema).optional(),
});

export type PageEnrichmentResponse = z.infer<typeof PageEnrichmentResponseSchema>;
