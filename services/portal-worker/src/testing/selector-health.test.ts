import assert from "node:assert/strict";
import { checkSelectorHealth } from "../health/checkSelectorHealth";
import { runSelectorHealthChecks } from "../health/runSelectorHealthChecks";

class MockLocator {
  constructor(private readonly visibleCount: number) {}

  async count(): Promise<number> {
    return this.visibleCount;
  }

  nth(): MockLocator {
    return new MockLocator(this.visibleCount > 0 ? 1 : 0);
  }

  async isVisible(): Promise<boolean> {
    return this.visibleCount > 0;
  }

  async isEnabled(): Promise<boolean> {
    return true;
  }

  async click(): Promise<void> {}

  async textContent(): Promise<string | null> {
    return null;
  }

  async innerText(): Promise<string> {
    return "";
  }

  async inputValue(): Promise<string> {
    return "";
  }

  async fill(): Promise<void> {}

  async evaluate<T>(_pageFunction: (node: unknown) => T | Promise<T>): Promise<T> {
    return "" as T;
  }
}

class MockPage {
  constructor(
    private readonly selectorCounts: Record<string, number>,
    private readonly buttonCounts: Record<string, number> = {},
    private readonly urlValue = "https://example.test/documents/note/visitnote/123",
  ) {}

  locator(selector: string): MockLocator {
    return new MockLocator(this.selectorCounts[selector] ?? 0);
  }

  getByRole(
    _role: "button" | "link",
    options: { name: string | RegExp },
  ): MockLocator {
    const key = String(options.name);
    return new MockLocator(this.buttonCounts[key] ?? 0);
  }

  getByLabel(_text: string | RegExp): MockLocator {
    return new MockLocator(0);
  }

  url(): string {
    return this.urlValue;
  }
}

const tests: Array<{ name: string; run: () => Promise<void> | void }> = [
  {
    name: "checkSelectorHealth marks one visible match as healthy",
    run: async () => {
      const result = await checkSelectorHealth({
        page: new MockPage({
          'textarea[formcontrolname="frequencySummary"]': 1,
        }),
        entry: {
          name: "VISIT_NOTE.frequencySummary.writeTarget",
          documentKind: "VISIT_NOTE",
          phase: "WRITE_EXECUTION",
          expectedCardinality: "ONE",
          required: true,
          targetField: "frequencySummary",
          action: null,
          candidates: [
            {
              kind: "selector",
              value: 'textarea[formcontrolname="frequencySummary"]',
              description: 'textarea[formcontrolname="frequencySummary"]',
            },
          ],
          supportDisposition: "EXECUTABLE",
        },
      });

      assert.equal(result.status, "HEALTHY");
      assert.equal(result.matchedCount, 1);
    },
  },
  {
    name: "checkSelectorHealth marks multiple visible matches as ambiguous",
    run: async () => {
      const result = await checkSelectorHealth({
        page: new MockPage({
          'textarea[formcontrolname="frequencySummary"]': 2,
        }),
        entry: {
          name: "VISIT_NOTE.frequencySummary.writeTarget",
          documentKind: "VISIT_NOTE",
          phase: "WRITE_EXECUTION",
          expectedCardinality: "ONE",
          required: true,
          targetField: "frequencySummary",
          action: null,
          candidates: [
            {
              kind: "selector",
              value: 'textarea[formcontrolname="frequencySummary"]',
              description: 'textarea[formcontrolname="frequencySummary"]',
            },
          ],
          supportDisposition: "EXECUTABLE",
        },
      });

      assert.equal(result.status, "AMBIGUOUS");
      assert.equal(result.matchedCount, 2);
    },
  },
  {
    name: "runSelectorHealthChecks reports page-state mismatch without drift for extraction routes",
    run: async () => {
      const result = await runSelectorHealthChecks({
        page: new MockPage(
          {
            "main h1": 1,
            section: 1,
          },
          {},
          "https://example.test/documents/order/999",
        ) as never,
        documentKind: "VISIT_NOTE",
        phase: "EXTRACTION",
      });

      assert.equal(result.runtimeDiagnostics.some((entry) => entry.code === "PAGE_KIND_MISMATCH"), true);
      assert.equal(result.driftSignals.some((entry) => entry.type === "ROUTE_PATTERN_CHANGED"), false);
    },
  },
];

let passed = 0;

async function main(): Promise<void> {
  for (const entry of tests) {
    await entry.run();
    passed += 1;
  }

  console.log(`selector-health tests passed: ${passed}/${tests.length}`);
}

void main();
