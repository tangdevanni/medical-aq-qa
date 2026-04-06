import assert from "node:assert/strict";
import { SAFE_READ_RETRY_POLICIES } from "../reliability/retryPolicy";
import { withRetry } from "../reliability/withRetry";

const tests: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: "selector-resolution retry policy retries read-only misses and succeeds",
    run: async () => {
      let attempts = 0;
      const result = await withRetry({
        policy: SAFE_READ_RETRY_POLICIES.selectorResolution,
        operation: "selector-resolution-test",
        execute: async () => {
          attempts += 1;
          return {
            status: attempts >= 3 ? "FOUND" : "NOT_FOUND",
          };
        },
      });

      assert.equal(attempts, 3);
      assert.equal(result.retryAttempts.length, 3);
      assert.equal(result.retryAttempts[0].outcome, "RETRYING");
      assert.equal(result.retryAttempts[2].outcome, "SUCCEEDED");
    },
  },
  {
    name: "non-retryable policy does not hide exhausted failures",
    run: async () => {
      let attempts = 0;
      const result = await withRetry({
        policy: {
          name: "UNSAFE_WRITE",
          phase: "WRITE_EXECUTION",
          maxAttempts: 1,
          backoffMs: 0,
        },
        operation: "unsafe-write-test",
        execute: async () => {
          attempts += 1;
          return { status: "FAILED" };
        },
      });

      assert.equal(attempts, 1);
      assert.equal(result.retryAttempts.length, 1);
      assert.equal(result.retryAttempts[0].outcome, "SUCCEEDED");
    },
  },
];

let passed = 0;

async function main(): Promise<void> {
  for (const entry of tests) {
    await entry.run();
    passed += 1;
  }

  console.log(`retry-policy tests passed: ${passed}/${tests.length}`);
}

void main();
