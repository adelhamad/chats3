// Test runner for all tests
import { run } from "node:test";
import { spec as SpecReporter } from "node:test/reporters";
import { glob } from "glob";

// Find all test files
const testFiles = await glob("tests/**/*.test.js");

console.log("Running tests:\n");
testFiles.forEach((file) => console.log(`  - ${file}`));
console.log("");

// Run tests
run({
  files: testFiles,
})
  .compose(new SpecReporter())
  .pipe(process.stdout);
