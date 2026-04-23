import assert from "node:assert/strict";
import { type QaDecision } from "@medical-ai-qa/shared-types";
import { executeWriteDecision } from "../writes/writeExecutor";
import { resolveWriteExecutionConfig } from "../writes/writeExecutionConfig";

class FakeFieldNode {
  constructor(
    public label: string,
    public value: string,
    public visible = true,
    public enabled = true,
    public fillBehavior: "normal" | "ignore" = "normal",
  ) {}
}

class FakeLocator {
  constructor(private readonly nodes: FakeFieldNode[]) {}

  async count(): Promise<number> {
    return this.nodes.length;
  }

  nth(index: number): FakeLocator {
    return new FakeLocator(this.nodes[index] ? [this.nodes[index]] : []);
  }

  async isVisible(): Promise<boolean> {
    return this.nodes[0]?.visible ?? false;
  }

  async isEnabled(): Promise<boolean> {
    return this.nodes[0]?.enabled ?? false;
  }

  async inputValue(): Promise<string> {
    return this.nodes[0]?.value ?? "";
  }

  async textContent(): Promise<string | null> {
    return this.nodes[0]?.value ?? null;
  }

  async innerText(): Promise<string> {
    return this.nodes[0]?.value ?? "";
  }

  async fill(value: string): Promise<void> {
    if (!this.nodes[0]) {
      throw new Error("Missing node");
    }

    if (this.nodes[0].fillBehavior === "normal") {
      this.nodes[0].value = value;
    }
  }

  async evaluate<T>(pageFunction: (node: unknown) => T | Promise<T>): Promise<T> {
    return pageFunction({});
  }
}

class FakePage {
  constructor(
    private readonly selectors: Record<string, FakeFieldNode[]>,
    private readonly labels: FakeFieldNode[],
    private readonly currentUrl = "https://example.test/documents/note/visitnote/123",
  ) {}

  locator(selector: string): FakeLocator {
    return new FakeLocator(this.selectors[selector] ?? []);
  }

  getByLabel(text: string | RegExp): FakeLocator {
    const matcher = typeof text === "string"
      ? (value: string) => value === text
      : (value: string) => text.test(value);

    return new FakeLocator(this.labels.filter((node) => matcher(node.label)));
  }

  url(): string {
    return this.currentUrl;
  }
}

function buildDecision(input?: Partial<QaDecision>): QaDecision {
  return {
    ...baseDecision(),
    ...input,
    proposedAction: {
      ...baseDecision().proposedAction,
      ...input?.proposedAction,
    },
  };
}

function baseDecision(): QaDecision {
  return {
    decisionType: "PROPOSE_UPDATE" as const,
    issueType: "FREQUENCY_MISMATCH" as const,
    actionability: "ACTIONABLE" as const,
    autoFixEligibility: "SAFE_AUTOFIX_CANDIDATE" as const,
    confidence: "HIGH" as const,
    sourceOfTruth: {
      sourceDocumentKind: "PLAN_OF_CARE" as const,
      targetDocumentKind: "VISIT_NOTE" as const,
      confidence: "HIGH" as const,
      reason: "source",
    },
    proposedAction: {
      targetDocumentKind: "VISIT_NOTE" as const,
      targetField: "frequencySummary",
      action: "UPDATE_FIELD" as const,
      proposedValue: "PT twice weekly",
      changeStrategy: "REPLACE" as const,
    },
    reason: "reason",
    evidence: {
      sourceAnchors: [],
      targetAnchors: [
        {
          documentKind: "VISIT_NOTE" as const,
          field: "frequencySummary",
          summary: "PT once weekly",
        },
      ],
      warningCodes: [],
    },
    humanReviewReasons: [],
  };
}

async function readVisitNoteDocument() {
  return {
    documentKind: "VISIT_NOTE" as const,
    pageType: "visit_note" as const,
    url: "https://example.test/documents/note/visitnote/123",
    extractedAt: "2026-03-24T00:00:00.000Z",
    metadata: {
      pageTitle: "Visit Note",
      documentLabel: "Visit Note",
      patientMaskedId: "***1234",
      visitDate: "03/24/2026",
      physician: "D*** S***",
      signedState: "signed" as const,
      diagnosisSummary: null,
      frequencySummary: "PT once weekly",
      homeboundSummary: null,
      orderSummary: null,
    },
    sections: [],
    warnings: [],
  };
}

async function readVisitNoteDocumentWithBlankFrequency() {
  const document = await readVisitNoteDocument();

  return {
    ...document,
    metadata: {
      ...document.metadata,
      frequencySummary: null,
    },
  };
}

const tests: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: "dry-run returns skipped eligible attempt",
    run: async () => {
      const field = new FakeFieldNode("Visit Frequency", "PT once weekly");
      const page = new FakePage({
        'textarea[formcontrolname="frequencySummary"]': [field],
      }, [field]);

      const result = await executeWriteDecision({
        page,
        decision: buildDecision(),
        bundleConfidence: "HIGH",
        currentDocumentKind: "VISIT_NOTE",
        config: resolveWriteExecutionConfig({
          writeMode: "DRY_RUN",
          writesEnabled: true,
        }),
        writesAttemptedSoFar: 0,
        documentReader: readVisitNoteDocument as never,
      });

      assert.equal(result.status, "SKIPPED");
      assert.equal(result.guardFailures.includes("WRITE_MODE_DRY_RUN"), true);
      assert.equal(field.value, "PT once weekly");
    },
  },
  {
    name: "already matching fields become skipped no-op",
    run: async () => {
      const field = new FakeFieldNode("Visit Frequency", "PT twice weekly");
      const page = new FakePage({
        'textarea[formcontrolname="frequencySummary"]': [field],
      }, [field]);

      const result = await executeWriteDecision({
        page,
        decision: buildDecision({
          evidence: {
            sourceAnchors: [],
            targetAnchors: [],
            warningCodes: [],
          },
        }),
        bundleConfidence: "HIGH",
        currentDocumentKind: "VISIT_NOTE",
        config: resolveWriteExecutionConfig({
          writeMode: "EXECUTE",
          writesEnabled: true,
        }),
        writesAttemptedSoFar: 0,
        documentReader: readVisitNoteDocument as never,
      });

      assert.equal(result.status, "SKIPPED");
      assert.equal(result.verificationPassed, true);
    },
  },
  {
    name: "selector ambiguity blocks write",
    run: async () => {
      const fieldA = new FakeFieldNode("Visit Frequency", "PT once weekly");
      const fieldB = new FakeFieldNode("Visit Frequency", "PT once weekly");
      const page = new FakePage({
        'textarea[formcontrolname="frequencySummary"]': [fieldA, fieldB],
      }, [fieldA, fieldB]);

      const result = await executeWriteDecision({
        page,
        decision: buildDecision(),
        bundleConfidence: "HIGH",
        currentDocumentKind: "VISIT_NOTE",
        config: resolveWriteExecutionConfig({
          writeMode: "EXECUTE",
          writesEnabled: true,
        }),
        writesAttemptedSoFar: 0,
        documentReader: readVisitNoteDocument as never,
      });

      assert.equal(result.status, "BLOCKED");
      assert.equal(result.guardFailures.includes("TARGET_SELECTOR_AMBIGUOUS"), true);
    },
  },
  {
    name: "successful write is verified",
    run: async () => {
      const field = new FakeFieldNode("Visit Frequency", "PT once weekly");
      const page = new FakePage({
        'textarea[formcontrolname="frequencySummary"]': [field],
      }, [field]);

      const result = await executeWriteDecision({
        page,
        decision: buildDecision(),
        bundleConfidence: "HIGH",
        currentDocumentKind: "VISIT_NOTE",
        config: resolveWriteExecutionConfig({
          writeMode: "EXECUTE",
          writesEnabled: true,
        }),
        writesAttemptedSoFar: 0,
        documentReader: readVisitNoteDocument as never,
      });

      assert.equal(result.status, "VERIFIED");
      assert.equal(result.finalValue, "PT twice weekly");
    },
  },
  {
    name: "post-write verification failure is surfaced",
    run: async () => {
      const field = new FakeFieldNode("Visit Frequency", "PT once weekly", true, true, "ignore");
      const page = new FakePage({
        'textarea[formcontrolname="frequencySummary"]': [field],
      }, [field]);

      const result = await executeWriteDecision({
        page,
        decision: buildDecision(),
        bundleConfidence: "HIGH",
        currentDocumentKind: "VISIT_NOTE",
        config: resolveWriteExecutionConfig({
          writeMode: "EXECUTE",
          writesEnabled: true,
        }),
        writesAttemptedSoFar: 0,
        documentReader: readVisitNoteDocument as never,
      });

      assert.equal(result.status, "VERIFICATION_FAILED");
      assert.equal(result.guardFailures.includes("POST_WRITE_VERIFICATION_FAILED"), true);
    },
  },
  {
    name: "disabled fields block before write",
    run: async () => {
      const field = new FakeFieldNode("Visit Frequency", "PT once weekly", true, false);
      const page = new FakePage({
        'textarea[formcontrolname="frequencySummary"]': [field],
      }, [field]);

      const result = await executeWriteDecision({
        page,
        decision: buildDecision(),
        bundleConfidence: "HIGH",
        currentDocumentKind: "VISIT_NOTE",
        config: resolveWriteExecutionConfig({
          writeMode: "EXECUTE",
          writesEnabled: true,
        }),
        writesAttemptedSoFar: 0,
        documentReader: readVisitNoteDocument as never,
      });

      assert.equal(result.status, "BLOCKED");
      assert.equal(result.guardFailures.includes("FIELD_NOT_EDITABLE"), true);
    },
  },
  {
    name: "blank current values remain blocked for allowlisted replacements",
    run: async () => {
      const field = new FakeFieldNode("Visit Frequency", "");
      const page = new FakePage({
        'textarea[formcontrolname="frequencySummary"]': [field],
      }, [field]);

      const result = await executeWriteDecision({
        page,
        decision: buildDecision({
          evidence: {
            sourceAnchors: [],
            targetAnchors: [],
            warningCodes: [],
          },
        }),
        bundleConfidence: "HIGH",
        currentDocumentKind: "VISIT_NOTE",
        config: resolveWriteExecutionConfig({
          writeMode: "EXECUTE",
          writesEnabled: true,
        }),
        writesAttemptedSoFar: 0,
        documentReader: readVisitNoteDocumentWithBlankFrequency as never,
      });

      assert.equal(result.status, "BLOCKED");
      assert.equal(result.guardFailures.includes("FIELD_STATE_MISMATCH"), true);
      assert.equal(field.value, "");
    },
  },
];

let passed = 0;

async function main(): Promise<void> {
  for (const entry of tests) {
    await entry.run();
    passed += 1;
  }

  console.log(`write-executor tests passed: ${passed}/${tests.length}`);
}

void main();
