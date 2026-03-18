#!/usr/bin/env node
/**
 * Runs all test suites and prints a summary, even if some suites fail.
 * Exits with code 1 if any suite failed.
 */

import { spawnSync } from "child_process";

const suites = [
    { name: "API tests",            cmd: "pnpm", args: ["run", "api:test"] },
    { name: "Extension unit tests", cmd: "pnpm", args: ["run", "ext:test"] },
    { name: "Extension E2E tests",  cmd: "pnpm", args: ["run", "ext:test:e2e"] },
];

const results = [];

for (const suite of suites) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Running: ${suite.name}`);
    console.log("─".repeat(60));

    const result = spawnSync(suite.cmd, suite.args, { stdio: "inherit", shell: true });
    results.push({ name: suite.name, passed: result.status === 0 });
}

// ── Summary ───────────────────────────────────────────────────────────────────

const width = 60;
console.log(`\n${"═".repeat(width)}`);
console.log(" Test Summary");
console.log("═".repeat(width));

for (const { name, passed } of results) {
    const icon = passed ? "✓" : "✗";
    console.log(`  ${icon}  ${name}`);
}

const failed = results.filter((r) => !r.passed);
console.log("─".repeat(width));
if (failed.length === 0) {
    console.log("  All suites passed.");
} else {
    console.log(`  ${failed.length} of ${results.length} suite${failed.length !== 1 ? "s" : ""} failed.`);
}
console.log("═".repeat(width));

process.exit(failed.length > 0 ? 1 : 0);
