import path from "node:path";
import pc from "picocolors";
import { loadConfig } from "../config/load-config.js";
import { discoverSourceFiles } from "../discovery/source-files.js";
import { extractExpressRoutes } from "../extractors/express-routes.js";
import { parseOpenApiSpec } from "../openapi/parse-spec.js";
import { compareRoutes } from "../comparison/compare-routes.js";
import { printTerminalReport } from "../reporters/terminal.js";
import { printJsonReport } from "../reporters/json.js";
import { printGitHubAnnotations } from "../reporters/github.js";
import { version } from "../version.js";
import type {
  CheckOptions,
  ComparisonResult,
  SpecSyncConfig,
} from "../types.js";

/**
 * Programmatically runs the SpecSync route-to-spec check and returns the ComparisonResult.
 */
export async function runCheck(
  options: CheckOptions = {},
  cwd: string = process.cwd()
): Promise<ComparisonResult> {
  // Normalize CLI overrides
  const overrides: Partial<SpecSyncConfig> = {};

  if (options.openapi) {
    overrides.openapi = options.openapi;
  }
  if (options.basePath !== undefined) {
    overrides.basePath = options.basePath;
  }
  if (options.failOn) {
    overrides.failOn = options.failOn;
  }
  if (options.source) {
    if (typeof options.source === "string") {
      overrides.source = (options.source as string)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(options.source)) {
      overrides.source = options.source;
    }
  }

  // 1. Load configuration (with CLI overrides taking precedence)
  const config = await loadConfig(cwd, options.config, overrides);

  // If explicit config path was provided, discover source files relative to its directory
  const baseDir = options.config
    ? path.dirname(path.resolve(cwd, options.config))
    : cwd;

  // 2. Discover Express route source files
  const filePaths = await discoverSourceFiles({
    cwd: baseDir,
    sourcePatterns: config.source,
    excludePatterns: config.exclude,
  });

  // 3. Statically extract Express routes via AST
  const sourceInventory = await extractExpressRoutes(filePaths, config.basePath);

  // 4. Parse OpenAPI specification document
  const specInventory = await parseOpenApiSpec(config.openapi, config.basePath);

  // 5. Deterministically compare source routes against OpenAPI operations
  const result = compareRoutes(sourceInventory, specInventory, {
    failOn: config.failOn,
  });

  return result;
}

/**
 * Commander action handler for `specsync check`.
 */
export async function checkCommand(
  rawOptions: Record<string, any> = {}
): Promise<void> {
  const options: CheckOptions = {
    config: rawOptions.config,
    source: rawOptions.source,
    openapi: rawOptions.openapi,
    basePath: rawOptions.basePath,
    format: rawOptions.json ? "json" : "terminal",
    failOn: rawOptions.failOn,
    quiet: Boolean(rawOptions.quiet),
    githubAnnotations: rawOptions.githubAnnotations,
  };

  try {
    const result = await runCheck(options);

    if (!options.quiet) {
      if (options.format === "json") {
        printJsonReport(result);
      } else {
        printTerminalReport(result);
      }
    }

    const shouldAnnotate =
      options.githubAnnotations !== undefined
        ? options.githubAnnotations
        : process.env.GITHUB_ACTIONS === "true";

    if (!options.quiet && shouldAnnotate && options.format !== "json") {
      printGitHubAnnotations(result);
    }

    process.exitCode = result.summary.exitCode;
  } catch (err) {
    const message = (err as Error).message || String(err);

    if (!options.quiet) {
      if (options.format === "json") {
        console.log(
          JSON.stringify(
            {
              specsync: version,
              error: message,
              exitCode: 1,
            },
            null,
            2
          )
        );
      } else {
        console.error(pc.red(pc.bold("✖ ERROR: ")) + message);
      }
    }

    process.exitCode = 1;
  }
}
