import { describe, it, expect, vi } from "vitest";
import {
  formatTerminalReport,
  printTerminalReport,
} from "../src/reporters/terminal.js";
import {
  formatJsonReport,
  printJsonReport,
} from "../src/reporters/json.js";
import type { ComparisonResult } from "../src/types.js";
import { version } from "../src/version.js";

function makeCleanResult(): ComparisonResult {
  return {
    discrepancies: [],
    limitations: [],
    summary: {
      routesAnalyzed: 10,
      openApiOperations: 10,
      mismatches: 0,
      undocumentedCount: 0,
      staleCount: 0,
      methodMismatchCount: 0,
      limitationsCount: 0,
      hasErrors: false,
      exitCode: 0,
    },
  };
}

function makeDriftResult(): ComparisonResult {
  return {
    discrepancies: [
      {
        type: "UNDOCUMENTED_ROUTE",
        severity: "error",
        method: "DELETE",
        path: "/users/{id}",
        sourceLocation: { file: "src/routes/users.ts", line: 42, column: 1 },
        specLocation: { file: "openapi.yaml" },
        message: 'Route DELETE "/users/{id}" exists in source but is missing from OpenAPI specification.',
        suggestion: 'Add the operation to openapi.yaml.',
      },
      {
        type: "STALE_SPEC_PATH",
        severity: "error",
        method: "GET",
        path: "/legacy-reports",
        specLocation: { file: "openapi.yaml", line: 15 },
        message: 'Documented operation GET "/legacy-reports" has no matching supported source route found.',
        suggestion: 'Verify whether this route is implemented or remove it from openapi.yaml.',
      },
      {
        type: "METHOD_MISMATCH",
        severity: "warning",
        method: "POST",
        path: "/orders",
        sourceLocation: { file: "src/routes/orders.ts", line: 10 },
        specLocation: { file: "openapi.yaml" },
        message: 'HTTP method POST exists in code for "/orders", but OpenAPI only declares: [GET] (Note: dynamic routes or limitations were detected in source; this route might be handled dynamically).',
        suggestion: 'Add the "POST" operation to openapi.yaml.',
      },
    ],
    limitations: [
      {
        type: "DYNAMIC_ROUTE",
        file: "src/routes/admin.ts",
        location: { file: "src/routes/admin.ts", line: 15 },
        message: 'Dynamic route path "config.adminPath" could not be statically resolved.',
        snippet: 'app.get(config.adminPath, handler);',
      },
    ],
    summary: {
      routesAnalyzed: 12,
      openApiOperations: 14,
      mismatches: 3,
      undocumentedCount: 1,
      staleCount: 1,
      methodMismatchCount: 1,
      limitationsCount: 1,
      hasErrors: true,
      exitCode: 1,
    },
  };
}

describe("formatTerminalReport", () => {
  it("returns empty string when quiet option is true", () => {
    const result = makeDriftResult();
    const output = formatTerminalReport(result, { quiet: true });
    expect(output).toBe("");
  });

  it("formats clean match report with checkmark and counts", () => {
    const result = makeCleanResult();
    const output = formatTerminalReport(result);

    expect(output).toContain("SpecSync");
    expect(output).toContain("All routes and OpenAPI operations match");
    expect(output).toContain("10 routes analyzed");
    expect(output).toContain("10 OpenAPI operations");
  });

  it("formats limitations section when limitations exist", () => {
    const result = makeDriftResult();
    const output = formatTerminalReport(result);

    expect(output).toContain("Analysis Limitations (1)");
    expect(output).toContain("DYNAMIC_ROUTE");
    expect(output).toContain("src/routes/admin.ts:15");
    expect(output).toContain("Dynamic route path");
    expect(output).toContain("Snippet: app.get(config.adminPath, handler);");
  });

  it("formats all discrepancy types with badges, locations, and suggestions", () => {
    const result = makeDriftResult();
    const output = formatTerminalReport(result);

    // ERROR Undocumented route
    expect(output).toContain("ERROR");
    expect(output).toContain("Undocumented Route");
    expect(output).toContain("DELETE");
    expect(output).toContain("/users/{id}");
    expect(output).toContain("→");
    expect(output).toContain("Add the operation to openapi.yaml.");

    // Stale spec path
    expect(output).toContain("Stale Specification Path");
    expect(output).toContain("/legacy-reports");
    expect(output).toContain("Spec:   openapi.yaml:15");

    // Method mismatch
    expect(output).toContain("WARN");
    expect(output).toContain("Method Mismatch");
    expect(output).toContain("/orders");
  });

  it("formats summary bar showing error counts and exit code", () => {
    const result = makeDriftResult();
    const output = formatTerminalReport(result);

    expect(output).toContain("Drift detected: 2 errors, 1 warning");
    expect(output).toContain("12 routes analyzed");
    expect(output).toContain("14 OpenAPI operations");
    expect(output).toContain("Exit code: 1");
  });

  it("printTerminalReport writes to console.log", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = makeCleanResult();

    printTerminalReport(result);

    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

describe("formatJsonReport", () => {
  it("formats result into valid parseable JSON", () => {
    const result = makeDriftResult();
    const jsonStr = formatJsonReport(result);

    const parsed = JSON.parse(jsonStr);
    expect(parsed.specsync).toBe(version);
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.summary.mismatches).toBe(3);
    expect(parsed.summary.exitCode).toBe(1);
    expect(parsed.discrepancies).toHaveLength(3);
    expect(parsed.limitations).toHaveLength(1);
  });

  it("respects custom timestamp option for deterministic outputs", () => {
    const result = makeCleanResult();
    const fixedTime = "2026-10-15T12:00:00.000Z";
    const jsonStr = formatJsonReport(result, { timestamp: fixedTime });

    const parsed = JSON.parse(jsonStr);
    expect(parsed.timestamp).toBe(fixedTime);
  });

  it("supports compact JSON formatting when pretty=false", () => {
    const result = makeCleanResult();
    const jsonStr = formatJsonReport(result, { pretty: false });

    expect(jsonStr).not.toContain("\n");
    const parsed = JSON.parse(jsonStr);
    expect(parsed.summary.mismatches).toBe(0);
  });

  it("printJsonReport writes to console.log", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = makeCleanResult();

    printJsonReport(result);

    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
