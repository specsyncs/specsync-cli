/**
 * SpecSync Distribution Smoke Test
 *
 * Verifies that the packed npm tarball for @specsyncs/cli:
 * 1. Contains all required files and no unwanted source/test files.
 * 2. Installs cleanly in an isolated project.
 * 3. CLI binary executes successfully with correct exit codes.
 * 4. Programmatic ESM exports function correctly.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

async function runCommand(
  cmd: string,
  args: string[],
  cwd: string = ROOT_DIR
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const isCmdScript = process.platform === "win32" && (cmd.endsWith(".cmd") || cmd === "npm");
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd,
      timeout: 60000,
      shell: isCmdScript,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: typeof err.code === "number" ? err.code : (err.status ?? 1),
    };
  }
}

export async function runPackSmokeTest(): Promise<void> {
  console.log("📦 Starting SpecSync Distribution Smoke Test...\n");

  let tarballPath: string | null = null;
  let tempDir: string | null = null;

  try {
    // 1. Pack the package into a tarball
    console.log("Step 1: Running `npm pack --json`...");
    const packRes = await runCommand(npmCmd, ["pack", "--json"], ROOT_DIR);
    if (packRes.exitCode !== 0) {
      throw new Error(`npm pack failed with code ${packRes.exitCode}:\n${packRes.stderr}`);
    }

    // Parse npm pack JSON output
    // npm output might contain non-JSON warnings before/after the JSON block
    const jsonStart = packRes.stdout.indexOf("[");
    const jsonEnd = packRes.stdout.lastIndexOf("]") + 1;
    if (jsonStart === -1 || jsonEnd === 0) {
      throw new Error(`Failed to locate JSON in npm pack output:\n${packRes.stdout}`);
    }
    const packMetadata = JSON.parse(packRes.stdout.substring(jsonStart, jsonEnd))[0];
    const filename = packMetadata.filename;
    tarballPath = path.resolve(ROOT_DIR, filename);

    if (!fs.existsSync(tarballPath)) {
      throw new Error(`Tarball not found at expected path: ${tarballPath}`);
    }
    console.log(`✔ Tarball created: ${filename} (${packMetadata.size} bytes)`);

    // Verify tarball contents
    const packedFiles: string[] = packMetadata.files.map((f: any) => f.path);
    console.log(`  Tarball contains ${packedFiles.length} files:`);
    for (const f of packedFiles) {
      console.log(`    - ${f}`);
    }

    const requiredFiles = ["LICENSE", "README.md", "package.json", "dist/cli.js", "dist/index.js", "dist/index.d.ts"];
    for (const req of requiredFiles) {
      if (!packedFiles.some((p) => p === req || p.endsWith(req))) {
        throw new Error(`Required file '${req}' is missing from tarball!`);
      }
    }
    // Check that tests, scripts, or docs are NOT packed
    const forbidden = ["tests/", "scripts/", "docs/", ".github/", ".benchmarks/"];
    for (const forb of forbidden) {
      if (packedFiles.some((p) => p.startsWith(forb))) {
        throw new Error(`Forbidden path '${forb}' leaked into tarball!`);
      }
    }
    console.log("✔ Tarball file whitelist verification passed.");

    // 2. Create isolated temporary test project
    console.log("\nStep 2: Creating isolated temporary workspace...");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "specsync-smoke-"));
    console.log(`✔ Temp workspace: ${tempDir}`);

    const tempPackageJson = {
      name: "smoke-workspace",
      version: "1.0.0",
      type: "module",
      private: true,
    };
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify(tempPackageJson, null, 2),
      "utf8"
    );

    // 3. Install the tarball
    console.log("\nStep 3: Installing tarball into temporary workspace...");
    const installRes = await runCommand(
      npmCmd,
      ["install", "--no-package-lock", tarballPath],
      tempDir
    );
    if (installRes.exitCode !== 0) {
      throw new Error(`npm install failed in temp workspace:\n${installRes.stderr}`);
    }
    console.log("✔ Tarball installed successfully.");

    // 4. Test CLI binary execution
    console.log("\nStep 4: Executing installed CLI binary...");
    const installedCli = path.join(tempDir, "node_modules", "@specsyncs", "cli", "dist", "cli.js");
    if (!fs.existsSync(installedCli)) {
      throw new Error(`Installed CLI not found at ${installedCli}`);
    }

    const versionRes = await runCommand(process.execPath, [installedCli, "--version"], tempDir);
    if (versionRes.exitCode !== 0 || versionRes.stdout.trim() !== packMetadata.version) {
      throw new Error(`CLI --version should report ${packMetadata.version}:\n${versionRes.stdout}\n${versionRes.stderr}`);
    }

    // 4a. Verify --help
    const helpRes = await runCommand(process.execPath, [installedCli, "check", "--help"], tempDir);
    if (helpRes.exitCode !== 0 || !helpRes.stdout.includes("Usage: specsync check")) {
      throw new Error(`CLI --help check failed:\n${helpRes.stdout}\n${helpRes.stderr}`);
    }
    console.log("✔ CLI --help output verified.");

    // 4b. Verify check on all-match scenario
    const allMatchConfig = path.join(ROOT_DIR, "tests", "fixtures", "scenarios", "all-match", "specsync.json");
    const matchRes = await runCommand(
      process.execPath,
      [installedCli, "check", "-c", allMatchConfig],
      tempDir
    );
    if (matchRes.exitCode !== 0 || !matchRes.stdout.includes("All routes and OpenAPI operations match")) {
      throw new Error(`all-match check failed:\n${matchRes.stdout}\n${matchRes.stderr}`);
    }
    console.log("✔ CLI all-match check passed (exit 0).");

    // 4c. Verify check on undocumented-route scenario
    const driftConfig = path.join(ROOT_DIR, "tests", "fixtures", "scenarios", "undocumented-route", "specsync.json");
    const driftRes = await runCommand(
      process.execPath,
      [installedCli, "check", "-c", driftConfig],
      tempDir
    );
    if (driftRes.exitCode !== 1 || !driftRes.stdout.includes("Drift detected")) {
      throw new Error(`undocumented-route check failed:\n${driftRes.stdout}\n${driftRes.stderr}`);
    }
    console.log("✔ CLI drift detection check passed (exit 1).");

    // 5. Test Programmatic ESM Import
    console.log("\nStep 5: Testing programmatic ESM import of @specsyncs/cli...");
    const testImportScript = `
import { runCheck, extractExpressRoutes, parseOpenApiSpec, compareRoutes } from "@specsyncs/cli";

if (typeof runCheck !== "function") throw new Error("runCheck is not a function");
if (typeof extractExpressRoutes !== "function") throw new Error("extractExpressRoutes is not a function");
if (typeof parseOpenApiSpec !== "function") throw new Error("parseOpenApiSpec is not a function");
if (typeof compareRoutes !== "function") throw new Error("compareRoutes is not a function");

const result = await runCheck({
  config: ${JSON.stringify(allMatchConfig)}
});

if (result.summary.exitCode !== 0) {
  throw new Error("Programmatic runCheck failed on all-match: exitCode " + result.summary.exitCode);
}

console.log("PROGRAMMATIC_API_OK");
`;
    fs.writeFileSync(path.join(tempDir, "test-import.js"), testImportScript, "utf8");

    const importRes = await runCommand(
      process.execPath,
      [path.join(tempDir, "test-import.js")],
      tempDir
    );
    if (importRes.exitCode !== 0 || !importRes.stdout.includes("PROGRAMMATIC_API_OK")) {
      throw new Error(`Programmatic ESM import failed:\n${importRes.stdout}\n${importRes.stderr}`);
    }
    console.log("✔ Programmatic ESM import verified.");

    console.log("\n🎉 ALL DISTRIBUTION SMOKE TESTS PASSED CLEANLY!");
  } finally {
    // Cleanup
    if (tarballPath && fs.existsSync(tarballPath)) {
      try {
        fs.unlinkSync(tarballPath);
        console.log(`\n🧹 Cleaned up tarball: ${tarballPath}`);
      } catch {}
    }
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`🧹 Cleaned up temp workspace: ${tempDir}`);
      } catch {}
    }
  }
}

// Execute directly if run as a script
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runPackSmokeTest().catch((err) => {
    console.error("✖ Distribution smoke test failed:", err);
    process.exit(1);
  });
}
