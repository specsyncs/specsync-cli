import type { ComparisonResult, ComparisonSummary, Discrepancy, AnalysisLimitation } from "../types.js";
import { version } from "../version.js";

export interface JsonReportPayload {
  specsync: string;
  timestamp: string;
  summary: ComparisonSummary;
  discrepancies: Discrepancy[];
  limitations: AnalysisLimitation[];
}

export interface JsonReportOptions {
  pretty?: boolean;
  timestamp?: string;
}

/**
 * Formats a ComparisonResult into a structured JSON string.
 */
export function formatJsonReport(
  result: ComparisonResult,
  options: JsonReportOptions = {}
): string {
  const pretty = options.pretty ?? true;
  const timestamp = options.timestamp ?? new Date().toISOString();

  const payload: JsonReportPayload = {
    specsync: version,
    timestamp,
    summary: result.summary,
    discrepancies: result.discrepancies,
    limitations: result.limitations,
  };

  return JSON.stringify(payload, null, pretty ? 2 : undefined);
}

/**
 * Prints the structured JSON report to standard output.
 */
export function printJsonReport(
  result: ComparisonResult,
  options: JsonReportOptions = {}
): void {
  console.log(formatJsonReport(result, options));
}
