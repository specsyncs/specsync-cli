#!/usr/bin/env node
import { Command } from "commander";
import { checkCommand } from "./commands/check.js";
import { version } from "./version.js";

const program = new Command("specsync")
  .version(version)
  .description("Static Express-to-OpenAPI drift detector");

program
  .command("check")
  .description("Compare Express routes against the OpenAPI specification")
  .option("-c, --config <path>", "Path to specsync config file")
  .option("-s, --source <globs>", "Source glob patterns (comma-separated)")
  .option("--openapi <path>", "Path to OpenAPI spec file")
  .option("--base-path <prefix>", "API base path prefix")
  .option("--json", "Output as JSON instead of terminal format")
  .option("--fail-on <level>", "Fail on: error | warning | never (default: error)")
  .option("-q, --quiet", "Suppress output, only use exit code")
  .option("--github-annotations", "Emit GitHub Actions workflow annotations")
  .option("--no-github-annotations", "Disable GitHub Actions workflow annotations")
  .action(checkCommand);

program.parse(process.argv);
