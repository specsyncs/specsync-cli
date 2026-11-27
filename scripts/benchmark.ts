#!/usr/bin/env node
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { version } from "../src/version.js";
import { BENCHMARK_TARGETS, type BenchmarkTarget } from "./benchmarks.config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BENCH_DIR = path.join(ROOT, ".benchmarks");
const REPORT_PATH = path.join(ROOT, "docs", "benchmarks", "day-07-report.json");
const CLI_PATH = path.join(ROOT, "dist", "cli.js");

export interface BenchmarkResult {
  id: string;
  name: string;
  timestamp: string;
  durationMs: number;
  exitCode: number;
  routesAnalyzed: number;
  openApiOperations: number;
  undocumentedCount: number;
  staleCount: number;
  methodMismatches: number;
  limitationsCount: number;
  limitationTypes: string[];
  discrepancies: Array<{
    type: string;
    method?: string;
    path: string;
    message: string;
  }>;
  limitations: Array<{
    type: string;
    message: string;
    file: string;
  }>;
  analysisNotes: string;
  error?: string;
}

async function prepareRepo(target: BenchmarkTarget): Promise<string> {
  const repoDir = path.join(BENCH_DIR, target.id);
  mkdirSync(BENCH_DIR, { recursive: true });

  if (!existsSync(repoDir)) {
    console.log(`  → Cloning ${target.name}...`);
    try {
      execSync(
        `git clone --depth 1 --branch ${target.branch} ${target.githubUrl} "${repoDir}"`,
        { stdio: "pipe" }
      );
      console.log(`  ✓ Cloned to ${repoDir}`);
    } catch (err: any) {
      // Retry without branch if branch fails
      console.log(`  → Retrying clone on default branch...`);
      execSync(
        `git clone --depth 1 ${target.githubUrl} "${repoDir}"`,
        { stdio: "pipe" }
      );
      console.log(`  ✓ Cloned to ${repoDir}`);
    }
  } else {
    console.log(`  ✓ Already cloned: ${repoDir}`);
  }

  // If external specUrl provided and spec doesn't exist, download it
  const specPath = path.join(repoDir, target.openApiSpec);
  if (target.specUrl && !existsSync(specPath)) {
    console.log(`  → Fetching external spec from ${target.specUrl}...`);
    const resp = await fetch(target.specUrl);
    if (!resp.ok) {
      throw new Error(`Failed to download spec from ${target.specUrl}: ${resp.statusText}`);
    }
    const specText = await resp.text();
    mkdirSync(path.dirname(specPath), { recursive: true });
    writeFileSync(specPath, specText, "utf-8");
    console.log(`  ✓ Saved spec to ${specPath}`);
  }

  return repoDir;
}

async function runBenchmark(target: BenchmarkTarget): Promise<BenchmarkResult> {
  console.log(`\n[${target.id}] Benchmarking: ${target.name}`);
  const repoDir = await prepareRepo(target);
  const specPath = path.join(repoDir, target.openApiSpec);

  // If spec file doesn't exist, record limitation
  if (!existsSync(specPath)) {
    return {
      id: target.id,
      name: target.name,
      timestamp: new Date().toISOString(),
      durationMs: 0,
      exitCode: 1,
      routesAnalyzed: 0,
      openApiOperations: 0,
      undocumentedCount: 0,
      staleCount: 0,
      methodMismatches: 0,
      limitationsCount: 1,
      limitationTypes: ["SPEC_NOT_FOUND"],
      discrepancies: [],
      limitations: [
        {
          type: "SPEC_NOT_FOUND",
          message: `Spec file not found at: ${specPath}`,
          file: specPath,
        },
      ],
      analysisNotes: `OpenAPI spec file was not found in repository.`,
    };
  }

  const args = [
    CLI_PATH,
    "check",
    "--source",
    target.sourcePatterns.join(","),
    "--openapi",
    specPath,
    "--json",
    "--fail-on",
    "never", // Don't fail the benchmark harness, collect data
    ...(target.basePath ? ["--base-path", target.basePath] : []),
  ];

  const startMs = Date.now();
  let exitCode = 0;
  let rawOutput = "";

  try {
    rawOutput = execFileSync(process.execPath, args, {
      cwd: repoDir,
      encoding: "utf-8",
      timeout: 60_000,
    });
  } catch (err: any) {
    exitCode = err.status ?? 1;
    rawOutput = err.stdout ?? "";
    if (!rawOutput) {
      return {
        id: target.id,
        name: target.name,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        exitCode,
        routesAnalyzed: 0,
        openApiOperations: 0,
        undocumentedCount: 0,
        staleCount: 0,
        methodMismatches: 0,
        limitationsCount: 1,
        limitationTypes: ["EXECUTION_ERROR"],
        discrepancies: [],
        limitations: [
          {
            type: "EXECUTION_ERROR",
            message: err.message,
            file: CLI_PATH,
          },
        ],
        analysisNotes: `CLI execution failed or timed out: ${err.message}`,
        error: err.message,
      };
    }
  }

  const durationMs = Date.now() - startMs;
  let parsed: any = {};
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return {
      id: target.id,
      name: target.name,
      timestamp: new Date().toISOString(),
      durationMs,
      exitCode,
      routesAnalyzed: 0,
      openApiOperations: 0,
      undocumentedCount: 0,
      staleCount: 0,
      methodMismatches: 0,
      limitationsCount: 1,
      limitationTypes: ["JSON_PARSE_ERROR"],
      discrepancies: [],
      limitations: [
        {
          type: "JSON_PARSE_ERROR",
          message: `Could not parse CLI output as JSON. Raw output: ${rawOutput.slice(0, 160)}`,
          file: CLI_PATH,
        },
      ],
      analysisNotes: `Output was not valid JSON.`,
      error: "JSON_PARSE_ERROR",
    };
  }

  const summary = parsed.summary ?? {};
  const limitations: any[] = parsed.limitations ?? [];
  const limitationTypes = [...new Set<string>(limitations.map((l: any) => l.type))];

  console.log(
    `  ✓ Finished in ${durationMs}ms: ${summary.routesAnalyzed ?? 0} routes analyzed, ${summary.openApiOperations ?? 0} spec operations, ${summary.mismatches ?? 0} mismatches, ${limitations.length} limitations`
  );

  return {
    id: target.id,
    name: target.name,
    timestamp: new Date().toISOString(),
    durationMs,
    exitCode,
    routesAnalyzed: summary.routesAnalyzed ?? 0,
    openApiOperations: summary.openApiOperations ?? 0,
    undocumentedCount: summary.undocumentedCount ?? 0,
    staleCount: summary.staleCount ?? 0,
    methodMismatches: summary.methodMismatchCount ?? 0,
    limitationsCount: limitations.length,
    limitationTypes,
    discrepancies: (parsed.discrepancies ?? []).map((d: any) => ({
      type: d.type,
      method: d.method,
      path: d.path,
      message: d.message,
    })),
    limitations: limitations.map((l: any) => ({
      type: l.type,
      message: l.message,
      file: l.file ?? l.location?.file ?? "",
    })),
    analysisNotes: target.notes,
  };
}

async function main() {
  console.log("=================================================================");
  console.log(" SpecSync Day 7 — Real-World OSS Repository Benchmark Runner");
  console.log("=================================================================\n");

  if (!existsSync(CLI_PATH)) {
    console.error(`ERROR: dist/cli.js not found. Run "npm run build" first.`);
    process.exit(1);
  }

  const results: BenchmarkResult[] = [];

  for (const target of BENCHMARK_TARGETS) {
    try {
      const res = await runBenchmark(target);
      results.push(res);
    } catch (err: any) {
      console.error(`  ✗ Error benchmarking ${target.id}:`, err.message);
      results.push({
        id: target.id,
        name: target.name,
        timestamp: new Date().toISOString(),
        durationMs: 0,
        exitCode: 2,
        routesAnalyzed: 0,
        openApiOperations: 0,
        undocumentedCount: 0,
        staleCount: 0,
        methodMismatches: 0,
        limitationsCount: 1,
        limitationTypes: ["CRASH"],
        discrepancies: [],
        limitations: [
          {
            type: "CRASH",
            message: err.message,
            file: target.githubUrl,
          },
        ],
        analysisNotes: `Runner exception: ${err.message}`,
        error: err.message,
      });
    }
  }

  // Save report JSON
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const report = {
    specsync: version,
    generatedAt: new Date().toISOString(),
    totalTargets: results.length,
    results,
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n✓ Benchmark report saved to: ${REPORT_PATH}`);

  // Print Summary Table
  console.log("\n─────────────────────────────────────────────────────────────────────────────────────────────");
  console.log(" Target ID                  | Routes | Operations | Drift (U/S/M) | Limitations | Time (ms)  ");
  console.log("─────────────────────────────────────────────────────────────────────────────────────────────");
  for (const r of results) {
    const id = r.id.padEnd(26);
    const routes = String(r.routesAnalyzed).padEnd(7);
    const ops = String(r.openApiOperations).padEnd(11);
    const drift = `${r.undocumentedCount}/${r.staleCount}/${r.methodMismatches}`.padEnd(14);
    const lims = `${r.limitationsCount} (${r.limitationTypes.join(",") || "none"})`.padEnd(12);
    const time = `${r.durationMs}ms`.padStart(9);
    console.log(` ${id} | ${routes} | ${ops} | ${drift} | ${lims} | ${time}`);
  }
  console.log("─────────────────────────────────────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("Fatal benchmark error:", err);
  process.exit(1);
});
