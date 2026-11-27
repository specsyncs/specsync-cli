import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { runCheck } from "../src/commands/check.js";
import { version } from "../src/version.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const SCENARIOS = path.join(__dirname, "fixtures", "scenarios");
const CLI_PATH = path.join(ROOT_DIR, "src", "cli.ts");

const TSX_CLI = path.join(ROOT_DIR, "node_modules", "tsx", "dist", "cli.mjs");

// Helper to execute the CLI via tsx directly with Node
async function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [TSX_CLI, CLI_PATH, ...args],
      {
        cwd: ROOT_DIR,
        timeout: 15000,
        env: { ...process.env, NO_COLOR: "1", ...env },
      }
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: typeof err.code === "number" ? err.code : (err.status ?? 1),
    };
  }
}

// ─── 1. Programmatic E2E (runCheck) ─────────────────────────────────────────

describe("e2e: programmatic runCheck across scenarios", () => {
  it("scenario: all-match produces 0 mismatches and exitCode 0", async () => {
    const configPath = path.join(SCENARIOS, "all-match", "specsync.json");
    const result = await runCheck(
      { config: configPath },
      path.dirname(configPath)
    );

    expect(result.discrepancies).toHaveLength(0);
    expect(result.summary.mismatches).toBe(0);
    expect(result.summary.hasErrors).toBe(false);
    expect(result.summary.exitCode).toBe(0);
  });

  it("scenario: undocumented-route produces exitCode 1 and flags route", async () => {
    const configPath = path.join(SCENARIOS, "undocumented-route", "specsync.json");
    const result = await runCheck(
      { config: configPath },
      path.dirname(configPath)
    );

    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0].type).toBe("UNDOCUMENTED_ROUTE");
    expect(result.discrepancies[0].method).toBe("DELETE");
    expect(result.discrepancies[0].path).toBe("/users/{id}");
    expect(result.summary.exitCode).toBe(1);
  });

  it("scenario: stale-spec-path produces exitCode 1 and flags stale path", async () => {
    const configPath = path.join(SCENARIOS, "stale-spec-path", "specsync.json");
    const result = await runCheck(
      { config: configPath },
      path.dirname(configPath)
    );

    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0].type).toBe("STALE_SPEC_PATH");
    expect(result.discrepancies[0].method).toBe("GET");
    expect(result.discrepancies[0].path).toBe("/legacy-reports");
    expect(result.summary.exitCode).toBe(1);
  });

  it("scenario: method-mismatch produces exitCode 1 and flags methods", async () => {
    const configPath = path.join(SCENARIOS, "method-mismatch", "specsync.json");
    const result = await runCheck(
      { config: configPath },
      path.dirname(configPath)
    );

    expect(result.discrepancies.length).toBeGreaterThan(0);
    for (const d of result.discrepancies) {
      expect(d.type).toBe("METHOD_MISMATCH");
    }
    expect(result.summary.exitCode).toBe(1);
  });

  it("scenario: dynamic-routes-warning respects failOn severity modes", async () => {
    const configPath = path.join(SCENARIOS, "dynamic-routes-warning", "specsync.json");
    const scenarioDir = path.dirname(configPath);

    // Default failOn="error": warning does NOT fail
    const resDefault = await runCheck({ config: configPath }, scenarioDir);
    expect(resDefault.limitations).toHaveLength(1);
    expect(resDefault.summary.exitCode).toBe(0);

    // With failOn="warning": warning DOES fail
    const resWarn = await runCheck(
      { config: configPath, failOn: "warning" },
      scenarioDir
    );
    expect(resWarn.summary.exitCode).toBe(1);
  });

  it("respects failOn='never' override", async () => {
    const configPath = path.join(SCENARIOS, "undocumented-route", "specsync.json");
    const result = await runCheck(
      { config: configPath, failOn: "never" },
      path.dirname(configPath)
    );

    expect(result.discrepancies).toHaveLength(1);
    expect(result.summary.exitCode).toBe(0);
  });
});

// ─── 2. Process-Level CLI Invocations ───────────────────────────────────────

describe("e2e: CLI process execution", () => {
  const annotationModes = [
    { mode: "auto-detected", githubActions: "true", flags: [] },
    {
      mode: "explicitly enabled",
      githubActions: "false",
      flags: ["--github-annotations"],
    },
  ];

  it("prints help and exits 0 on `check --help`", async () => {
    const { stdout, exitCode } = await runCli(["check", "--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: specsync check");
    expect(stdout).toContain("--config");
    expect(stdout).toContain("--openapi");
    expect(stdout).toContain("--json");
    expect(stdout).toContain("--fail-on");
    expect(stdout).toContain("--quiet");
  });

  it("exits 0 and outputs clean summary for all-match scenario", async () => {
    const configPath = path.join(SCENARIOS, "all-match", "specsync.json");
    const { stdout, exitCode } = await runCli(["check", "-c", configPath]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("All routes and OpenAPI operations match");
  });

  it("exits 1 and outputs error report for undocumented-route scenario", async () => {
    const configPath = path.join(SCENARIOS, "undocumented-route", "specsync.json");
    const { stdout, exitCode } = await runCli(["check", "-c", configPath]);

    expect(exitCode).toBe(1);
    expect(stdout).toContain("ERROR");
    expect(stdout).toContain("Undocumented Route");
    expect(stdout).toContain("DELETE /users/{id}");
  });

  it("outputs valid JSON with --json flag", async () => {
    const configPath = path.join(SCENARIOS, "undocumented-route", "specsync.json");
    const { stdout, exitCode } = await runCli(["check", "-c", configPath, "--json"]);

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.specsync).toBe(version);
    expect(parsed.summary.exitCode).toBe(1);
    expect(parsed.discrepancies).toHaveLength(1);
    expect(parsed.discrepancies[0].type).toBe("UNDOCUMENTED_ROUTE");
  });

  it.each(annotationModes)(
    "suppresses output with --quiet and $mode annotations",
    async ({ githubActions, flags }) => {
      const configPath = path.join(SCENARIOS, "undocumented-route", "specsync.json");
      const { stdout, stderr, exitCode } = await runCli(
        ["check", "-c", configPath, "--quiet", ...flags],
        { GITHUB_ACTIONS: githubActions }
      );

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
    }
  );

  it("exits 0 with --fail-on never even when drift exists", async () => {
    const configPath = path.join(SCENARIOS, "undocumented-route", "specsync.json");
    const { exitCode } = await runCli([
      "check",
      "-c",
      configPath,
      "--fail-on",
      "never",
    ]);

    expect(exitCode).toBe(0);
  });

  it.each(annotationModes)(
    "outputs $mode GitHub Actions annotations",
    async ({ githubActions, flags }) => {
      const configPath = path.join(SCENARIOS, "undocumented-route", "specsync.json");
      const { stdout, exitCode } = await runCli(["check", "-c", configPath, ...flags], {
        GITHUB_ACTIONS: githubActions,
      });

      expect(exitCode).toBe(1);
      expect(stdout).toContain("::error ");
      expect(stdout).toContain("title=UNDOCUMENTED_ROUTE");
    }
  );

  it("suppresses GitHub Actions annotations when --no-github-annotations is passed", async () => {
    const configPath = path.join(SCENARIOS, "undocumented-route", "specsync.json");
    const { stdout, exitCode } = await runCli(
      ["check", "-c", configPath, "--no-github-annotations"],
      { GITHUB_ACTIONS: "true" }
    );

    expect(exitCode).toBe(1);
    expect(stdout).not.toContain("::error ");
  });

  it("exits 1 with clear error message when config file is missing", async () => {
    const { stderr, exitCode } = await runCli([
      "check",
      "-c",
      "non-existent-config.json",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("ERROR");
    expect(stderr).toContain("Failed to load config file");
  });
});
