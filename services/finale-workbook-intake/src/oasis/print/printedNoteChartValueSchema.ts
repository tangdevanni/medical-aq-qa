import { z } from "zod";

const chartValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  z.null(),
]);

export const printedNoteChartValueSchema = z.object({
  field_key: z.string().min(1),
  current_value: chartValueSchema,
  confidence: z.number().min(0).max(1),
  source_spans: z.array(z.string().min(1)).min(1),
}).strict();

export const printedNoteChartValueExtractionSchema = z.object({
  current_field_values: z.array(printedNoteChartValueSchema),
  warnings: z.array(z.string()),
}).strict();

export type PrintedNoteChartValueExtractionSchema = z.infer<typeof printedNoteChartValueExtractionSchema>;

export function parsePrintedNoteChartValueExtractionPayload(
  text: string,
): PrintedNoteChartValueExtractionSchema | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  const parseCandidate = (candidate: string): PrintedNoteChartValueExtractionSchema | null => {
    try {
      return printedNoteChartValueExtractionSchema.parse(JSON.parse(candidate));
    } catch {
      return null;
    }
  };

  const direct = parseCandidate(normalized);
  if (direct) {
    return direct;
  }

  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  return parseCandidate(normalized.slice(firstBrace, lastBrace + 1));
}
