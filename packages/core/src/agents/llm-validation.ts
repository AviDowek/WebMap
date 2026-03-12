/**
 * LLM output validation with Zod schemas and retry logic.
 * Provides structured validation for all Claude API responses
 * in the doc generation pipeline.
 */

import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

// ─── Schemas ────────────────────────────────────────────────────────

/** Schema for CUA-mode page enrichment (concise visual docs) */
export const CuaPageEnrichmentSchema = z.object({
  purpose: z.string().min(1),
  visualLayout: z.string().min(1),
  navigationStrategy: z.string().min(1),
});
export type CuaPageEnrichment = z.infer<typeof CuaPageEnrichmentSchema>;

/** Schema for standard page enrichment (full element catalogs) */
export const PageEnrichmentSchema = z.object({
  purpose: z.string().min(1),
  howToReach: z.string().min(1),
  elementResults: z.record(z.string(), z.string()).default({}),
  dynamicBehavior: z.array(z.string()).default([]),
});
export type PageEnrichment = z.infer<typeof PageEnrichmentSchema>;

/** Schema for workflow detection */
export const WorkflowsSchema = z.object({
  workflows: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      steps: z.array(
        z.object({
          step: z.number(),
          description: z.string().min(1),
          selector: z.string().optional(),
          actionType: z.string().default("click"),
          value: z.string().optional(),
          expectedResult: z.string().default(""),
        })
      ),
    })
  ),
});
export type WorkflowsResponse = z.infer<typeof WorkflowsSchema>;

/** Schema for AI-generated benchmark tasks */
export const GeneratedTaskSchema = z.array(
  z.object({
    instruction: z.string().min(1),
    successCriteria: z.string().min(1),
    category: z.string().min(1),
  })
);
export type GeneratedTask = z.infer<typeof GeneratedTaskSchema>;

/** Schema for AI-generated diverse sites */
export const GeneratedSitesSchema = z.array(
  z.object({
    url: z.string().url(),
    category: z.string().min(1),
    description: z.string().min(1),
  })
);
export type GeneratedSite = z.infer<typeof GeneratedSitesSchema>;

// ─── Validation Utility ─────────────────────────────────────────────

export interface LLMCallOptions<T> {
  client: Anthropic;
  model: string;
  maxTokens: number;
  system?: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Max retry attempts on validation failure (default: 2) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 1000) */
  retryDelayMs?: number;
  /** Whether to match a JSON array instead of object (default: false) */
  matchArray?: boolean;
  /** Wrap the system prompt in a cache_control block so repeated calls hit the prompt cache (default: false) */
  cacheSystem?: boolean;
}

export interface LLMCallResult<T> {
  data: T | null;
  raw: string;
  attempts: number;
  tokensUsed: number;
  /** 0-1 confidence based on validation success */
  confidence: number;
  errors: string[];
}

/** Extract text from an Anthropic API response */
function extractText(response: Anthropic.Message): string {
  if (!response.content || response.content.length === 0) return "";
  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

/** Extract JSON from LLM text — object or array */
function extractJson(text: string, matchArray: boolean): unknown | null {
  const pattern = matchArray ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
  const match = text.match(pattern);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Call Claude API and validate the response against a Zod schema.
 * Retries with error feedback on validation failure.
 */
export async function callLLMWithValidation<T>(
  options: LLMCallOptions<T>
): Promise<LLMCallResult<T>> {
  const {
    client,
    model,
    maxTokens,
    system,
    prompt,
    schema,
    maxRetries = 2,
    retryDelayMs = 1000,
    matchArray = false,
    cacheSystem = false,
  } = options;

  // Build system parameter — cacheable array block or plain string
  const systemParam = system
    ? cacheSystem
      ? [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }]
      : system
    : undefined;

  let tokensUsed = 0;
  const errors: string[] = [];
  let lastRaw = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const userMessage =
      attempt === 0
        ? prompt
        : `${prompt}\n\nIMPORTANT: Your previous response could not be parsed. Error: ${errors[errors.length - 1]}. Please respond with ONLY valid JSON matching the specified format.`;

    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        ...(systemParam ? { system: systemParam as Parameters<typeof client.messages.create>[0]["system"] } : {}),
        messages: [{ role: "user", content: userMessage }],
      });

      tokensUsed +=
        (response.usage?.input_tokens || 0) +
        (response.usage?.output_tokens || 0);

      lastRaw = extractText(response);
      const parsed = extractJson(lastRaw, matchArray);

      if (parsed === null) {
        errors.push("No valid JSON found in response");
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, retryDelayMs));
        }
        continue;
      }

      const result = schema.safeParse(parsed);
      if (result.success) {
        return {
          data: result.data,
          raw: lastRaw,
          attempts: attempt + 1,
          tokensUsed,
          confidence: 1.0,
          errors,
        };
      }

      // Format Zod errors concisely
      const zodError = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      errors.push(zodError);

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      errors.push(`API error: ${errMsg}`);
      // Don't retry auth/permission failures — they are deterministic
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) break;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }

  return {
    data: null,
    raw: lastRaw,
    attempts: maxRetries + 1,
    tokensUsed,
    confidence: 0,
    errors,
  };
}
