import pc from "picocolors";
import type { ComparisonResult, DiscrepancyType } from "../types.js";
import { version } from "../version.js";

export interface TerminalReportOptions {
  quiet?: boolean;
}

const TYPE_LABELS: Record<DiscrepancyType, string> = {
  UNDOCUMENTED_ROUTE: "Undocumented Route",
  STALE_SPEC_PATH: "Stale Specification Path",
  METHOD_MISMATCH: "Method Mismatch",
};

/**
 * Formats a ComparisonResult into a developer-friendly terminal string.
 */
export function formatTerminalReport(
  result: ComparisonResult,
  options: TerminalReportOptions = {}
): string {
  if (options.quiet) {
    return "";
  }

  const lines: string[] = [];

  lines.push(pc.bold(pc.cyan("SpecSync")) + pc.dim(` v${version} — static route/spec drift detector`));
  lines.push("");

  // 1. Limitations section
  if (result.limitations.length > 0) {
    lines.push(
      pc.yellow(pc.bold(`⚠  Analysis Limitations (${result.limitations.length})`))
    );
    for (const lim of result.limitations) {
      const loc = lim.location
        ? `${lim.location.file}:${lim.location.line}`
        : lim.file;
      lines.push(
        `   ${pc.yellow(lim.type)}  ${pc.dim(loc)}`
      );
      lines.push(`   ${pc.dim(lim.message)}`);
      if (lim.snippet) {
        lines.push(`   ${pc.dim("Snippet: " + lim.snippet)}`);
      }
    }
    lines.push("");
  }

  // 2. Discrepancies section
  if (result.discrepancies.length > 0) {
    for (const d of result.discrepancies) {
      const isError = d.severity === "error";
      const badge = isError
        ? pc.red(pc.bold("✖ ERROR"))
        : pc.yellow(pc.bold("⚠ WARN "));
      const typeLabel = TYPE_LABELS[d.type] || d.type;

      lines.push(`${badge}  ${pc.bold(typeLabel)}`);

      // Method + Path
      const methodText = d.method ? pc.bold(pc.cyan(d.method)) + " " : "";
      lines.push(`        ${methodText}${pc.bold(d.path)}`);

      // Location
      if (d.sourceLocation) {
        const col = d.sourceLocation.column ? `:${d.sourceLocation.column}` : "";
        lines.push(
          `        ${pc.dim(`Source: ${d.sourceLocation.file}:${d.sourceLocation.line}${col}`)}`
        );
      }
      if (d.specLocation) {
        const line = d.specLocation.line ? `:${d.specLocation.line}` : "";
        lines.push(
          `        ${pc.dim(`Spec:   ${d.specLocation.file}${line}`)}`
        );
      }

      // Message
      lines.push(`        ${d.message}`);

      // Actionable Suggestion
      lines.push(`        ${pc.cyan("→")} ${pc.white(d.suggestion)}`);
      lines.push("");
    }
  }

  // 3. Summary Bar
  const errorCount = result.discrepancies.filter((d) => d.severity === "error").length;
  const warnCount = result.discrepancies.filter((d) => d.severity === "warning").length;

  const routesAnalyzed = result.summary.routesAnalyzed;
  const openApiOps = result.summary.openApiOperations;

  if (result.discrepancies.length === 0) {
    const limText =
      result.limitations.length > 0
        ? ` (${result.limitations.length} limitation${result.limitations.length === 1 ? "" : "s"})`
        : "";
    lines.push(
      pc.green(
        `✔ All routes and OpenAPI operations match${limText} · ${routesAnalyzed} route${routesAnalyzed === 1 ? "" : "s"} analyzed · ${openApiOps} OpenAPI operation${openApiOps === 1 ? "" : "s"}`
      )
    );
  } else {
    lines.push(
      pc.red(
        `✖ Drift detected: ${errorCount} error${errorCount === 1 ? "" : "s"}, ${warnCount} warning${warnCount === 1 ? "" : "s"} · ${routesAnalyzed} route${routesAnalyzed === 1 ? "" : "s"} analyzed · ${openApiOps} OpenAPI operation${openApiOps === 1 ? "" : "s"}`
      )
    );
    lines.push(pc.dim(`Exit code: ${result.summary.exitCode}`));
  }

  return lines.join("\n");
}

/**
 * Prints the formatted terminal report to standard output.
 */
export function printTerminalReport(
  result: ComparisonResult,
  options: TerminalReportOptions = {}
): void {
  const output = formatTerminalReport(result, options);
  if (output.length > 0) {
    console.log(output);
  }
}
