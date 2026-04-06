import assert from "node:assert/strict";
import { type DocumentKind, type QaDecision } from "@medical-ai-qa/shared-types";
import { executeWorkflowCompletion } from "../workflows/workflowExecutor";
import { resolveWorkflowExecutionConfig } from "../workflows/workflowExecutionConfig";

class FakeNode {
  constructor(
    public label: string,
    public visible = true,
    public enabled = true,
    public text: string | null = null,
    public onClick?: () => void,
  ) {}
}

class FakeLocator {
  constructor(private readonly nodes: FakeNode[]) {}

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

  async click(): Promise<void> {
    if (!this.nodes[0]) {
      throw new Error("Missing node");
    }

    this.nodes[0].onClick?.();
  }

  async textContent(): Promise<string | null> {
    return this.nodes[0]?.text ?? this.nodes[0]?.label ?? null;
  }

  async innerText(): Promise<string> {
    return this.nodes[0]?.text ?? this.nodes[0]?.label ?? "";
  }
}

class FakeWorkflowPage {
  constructor(
    private readonly selectors: Record<string, FakeNode[]>,
    private readonly buttons: FakeNode[],
    private readonly currentUrl = "https://example.test/documents/note/visitnote/123",
  ) {}

  locator(selector: string): FakeLocator {
    return new FakeLocator(this.selectors[selector] ?? []);
  }

  getByRole(
    role: "button" | "link",
    options: {
      name: string | RegExp;
      exact?: boolean;
    },
  ): FakeLocator {
    if (role !== "button") {
      return new FakeLocator([]);
    }

    const { name } = options;
    const matcher = typeof name === "string"
      ? (value: string) => options.exact ? value === name : value.toLowerCase().includes(name.toLowerCase())
      : (value: string) => name.test(value);

    return new FakeLocator(this.buttons.filter((button) => matcher(button.label)));
  }

  url(): string {
    return this.currentUrl;
  }

  async waitForTimeout(): Promise<void> {}
}

function buildDecisionResult(input?: {
  targetDocumentKind?: DocumentKind;
  targetField?: string;
  humanReviewReasons?: QaDecision["humanReviewReasons"];
}) {
  const targetDocumentKind = input?.targetDocumentKind ?? "VISIT_NOTE";
  const targetField = input?.targetField ?? "frequencySummary";
  const humanReviewReasons = input?.humanReviewReasons ?? [];

  return {
    decisions: [
      {
        decisionType: "PROPOSE_UPDATE" as const,
        issueType: "FREQUENCY_MISMATCH" as const,
        actionability: "ACTIONABLE" as const,
        autoFixEligibility: "SAFE_AUTOFIX_CANDIDATE" as const,
        confidence: "HIGH" as const,
        sourceOfTruth: {
          sourceDocumentKind: "PLAN_OF_CARE" as const,
          targetDocumentKind,
          confidence: "HIGH" as const,
          reason: "source",
        },
        proposedAction: {
          targetDocumentKind,
          targetField,
          action: "UPDATE_FIELD" as const,
          proposedValue: "PT twice weekly",
          changeStrategy: "REPLACE" as const,
        },
        reason: "reason",
        evidence: {
          sourceAnchors: [],
          targetAnchors: [],
          warningCodes: [],
        },
        humanReviewReasons,
      },
    ],
    warnings: [],
    summary: {
      actionableCount: 1,
      reviewOnlyCount: 0,
      notActionableCount: 0,
      safeAutofixCandidateCount: 1,
      manualReviewRequiredCount: humanReviewReasons.length ? 1 : 0,
      issuesByType: {
        FREQUENCY_MISMATCH: 1,
      },
      decisionsByTargetDocument: {
        [targetDocumentKind]: 1,
      },
    },
  };
}

function buildWriteExecutionResult(input?: {
  targetDocumentKind?: DocumentKind;
  targetField?: string;
}) {
  const targetDocumentKind = input?.targetDocumentKind ?? "VISIT_NOTE";
  const targetField = input?.targetField ?? "frequencySummary";

  return {
    attempted: true,
    results: [
      {
        status: "VERIFIED" as const,
        mode: "EXECUTE" as const,
        eligibility: "ELIGIBLE" as const,
        decisionType: "PROPOSE_UPDATE" as const,
        issueType: "FREQUENCY_MISMATCH" as const,
        targetDocumentKind,
        targetField,
        selectorUsed: "textarea[formcontrolname=\"frequencySummary\"]",
        previousValue: "PT once weekly",
        proposedValue: "PT twice weekly",
        finalValue: "PT twice weekly",
        verificationPassed: true,
        guardFailures: [],
        warnings: [],
        audit: {
          executedAt: "2026-03-24T00:00:00.000Z",
          bundleConfidence: "HIGH" as const,
          decisionConfidence: "HIGH" as const,
        },
      },
    ],
    summary: {
      writeAttempts: 1,
      writesExecuted: 1,
      writesVerified: 1,
      writesBlocked: 0,
      writesSkipped: 0,
      writeFailures: 0,
      verificationFailures: 0,
      dryRunCount: 0,
      topGuardFailureReasons: [],
    },
  };
}

function buildBaseInput(input: {
  page: FakeWorkflowPage | null;
  currentDocumentKind?: DocumentKind;
  targetField?: string;
  humanReviewReasons?: QaDecision["humanReviewReasons"];
}) {
  const currentDocumentKind = input.currentDocumentKind ?? "VISIT_NOTE";
  const targetField = input.targetField ?? (currentDocumentKind === "ADMISSION_ORDER" ? "orderSummary" : "frequencySummary");

  return {
    page: input.page,
    currentDocumentKind,
    crossDocumentQa: {
      bundleConfidence: "HIGH" as const,
      bundleReason: "matched",
      mismatches: [],
      alignments: [],
      warnings: [],
    },
    decisionResult: buildDecisionResult({
      targetDocumentKind: currentDocumentKind,
      targetField,
      humanReviewReasons: input.humanReviewReasons,
    }),
    writeExecutionResult: buildWriteExecutionResult({
      targetDocumentKind: currentDocumentKind,
      targetField,
    }),
  };
}

const tests: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: "dry-run planning does not mutate the page",
    run: async () => {
      let saveClicks = 0;
      const saveButton = new FakeNode("Save", true, true, null, () => {
        saveClicks += 1;
      });
      const page = new FakeWorkflowPage({
        'button[data-testid="visit-note-save"]': [saveButton],
      }, [saveButton]);

      const result = await executeWorkflowCompletion({
        ...buildBaseInput({ page }),
        config: resolveWorkflowExecutionConfig({
          safetyMode: "DRY_RUN_WRITE",
          workflowEnabled: true,
          workflowMode: "DRY_RUN",
        }),
      });

      assert.equal(result.status, "PARTIAL");
      assert.equal(result.steps[0]?.status, "PLANNED");
      assert.equal(saveClicks, 0);
    },
  },
  {
    name: "visit note save step verifies and then hands off to review-gated completion",
    run: async () => {
      const success = new FakeNode("saved", false, true, "Changes saved");
      const dirty = new FakeNode("unsaved", true, true, "Unsaved changes");
      const saveButton = new FakeNode("Save", true, true, null, () => {
        success.visible = true;
        dirty.visible = false;
      });
      const page = new FakeWorkflowPage({
        'button[data-testid="visit-note-save"]': [saveButton],
        '[data-testid="save-success-toast"]': [success],
        '[data-testid="unsaved-changes"]': [dirty],
      }, [saveButton]);

      const result = await executeWorkflowCompletion({
        ...buildBaseInput({ page }),
        config: resolveWorkflowExecutionConfig({
          safetyMode: "CONTROLLED_WRITE",
          workflowEnabled: true,
          workflowMode: "EXECUTE",
          allowedWorkflowActions: ["SAVE_PAGE"],
          requireOperatorCheckpointFor: [],
        }),
      });

      assert.equal(result.status, "PARTIAL");
      assert.equal(result.steps[0]?.status, "VERIFIED");
      assert.equal(result.steps[0]?.action, "SAVE_PAGE");
      assert.equal(result.steps[1]?.action, "VALIDATE_PAGE");
      assert.equal(result.steps[1]?.status, "BLOCKED");
      assert.equal(result.steps[2]?.action, "STOP_FOR_REVIEW");
    },
  },
  {
    name: "operator checkpoint blocks validate after a verified save",
    run: async () => {
      const success = new FakeNode("saved", false, true, "Changes saved");
      const dirty = new FakeNode("unsaved", true, true, "Unsaved changes");
      const saveButton = new FakeNode("Save", true, true, null, () => {
        success.visible = true;
        dirty.visible = false;
      });
      const validateButton = new FakeNode("Validate", true, true);
      const page = new FakeWorkflowPage({
        'button[data-testid="visit-note-save"]': [saveButton],
        '[data-testid="save-success-toast"]': [success],
        '[data-testid="unsaved-changes"]': [dirty],
        'button[data-testid="visit-note-validate"]': [validateButton],
      }, [saveButton, validateButton]);

      const result = await executeWorkflowCompletion({
        ...buildBaseInput({ page }),
        config: resolveWorkflowExecutionConfig({
          safetyMode: "CONTROLLED_WRITE",
          workflowEnabled: true,
          workflowMode: "EXECUTE",
          allowedWorkflowActions: ["SAVE_PAGE", "VALIDATE_PAGE"],
        }),
      });

      assert.equal(result.status, "PARTIAL");
      assert.equal(result.steps[0]?.status, "VERIFIED");
      assert.equal(result.steps[1]?.status, "BLOCKED");
      assert.equal(result.steps[1]?.guardFailures.includes("OPERATOR_CHECKPOINT_REQUIRED"), true);
      assert.equal(result.operatorCheckpoint?.required, true);
    },
  },
  {
    name: "save verification failure stops the workflow",
    run: async () => {
      const success = new FakeNode("saved", false, true, "Changes saved");
      const dirty = new FakeNode("unsaved", true, true, "Unsaved changes");
      const saveButton = new FakeNode("Save", true, true, null, () => {
        success.visible = false;
        dirty.visible = true;
      });
      const page = new FakeWorkflowPage({
        'button[data-testid="visit-note-save"]': [saveButton],
        '[data-testid="save-success-toast"]': [success],
        '[data-testid="unsaved-changes"]': [dirty],
      }, [saveButton]);

      const result = await executeWorkflowCompletion({
        ...buildBaseInput({ page }),
        config: resolveWorkflowExecutionConfig({
          safetyMode: "CONTROLLED_WRITE",
          workflowEnabled: true,
          workflowMode: "EXECUTE",
          allowedWorkflowActions: ["SAVE_PAGE"],
          requireOperatorCheckpointFor: [],
        }),
      });

      assert.equal(result.status, "FAILED");
      assert.equal(result.steps[0]?.status, "FAILED");
      assert.equal(result.steps[0]?.guardFailures.includes("POST_STEP_VERIFICATION_FAILED"), true);
    },
  },
  {
    name: "oasis workflow returns review-required with a review checkpoint and no execution",
    run: async () => {
      const result = await executeWorkflowCompletion({
        ...buildBaseInput({
          page: null,
          currentDocumentKind: "OASIS",
        }),
        config: resolveWorkflowExecutionConfig({
          safetyMode: "CONTROLLED_WRITE",
          workflowEnabled: true,
          workflowMode: "EXECUTE",
        }),
      });

      assert.equal(result.status, "REVIEW_REQUIRED");
      assert.equal(result.workflowSupport?.supportLevel, "REVIEW_GATED");
      assert.deepEqual(result.plan?.steps.map((step) => step.action), ["STOP_FOR_REVIEW"]);
      assert.equal(result.operatorCheckpoint?.category, "SOURCE_OF_TRUTH_REVIEW");
    },
  },
  {
    name: "plan of care workflow saves and then stops for operator review",
    run: async () => {
      const success = new FakeNode("saved", false, true, "Plan of care saved");
      const dirty = new FakeNode("unsaved", true, true, "Unsaved changes");
      const saveButton = new FakeNode("Save POC", true, true, null, () => {
        success.visible = true;
        dirty.visible = false;
      });
      const page = new FakeWorkflowPage({
        'button[data-testid="poc-save"]': [saveButton],
        '[data-testid="poc-save-success"]': [success],
        '[data-testid="unsaved-changes"]': [dirty],
      }, [saveButton], "https://example.test/documents/planofcare/456");

      const result = await executeWorkflowCompletion({
        ...buildBaseInput({
          page,
          currentDocumentKind: "PLAN_OF_CARE",
        }),
        config: resolveWorkflowExecutionConfig({
          safetyMode: "CONTROLLED_WRITE",
          workflowEnabled: true,
          workflowMode: "EXECUTE",
          allowedWorkflowActions: ["SAVE_PAGE"],
          requireOperatorCheckpointFor: [],
        }),
      });

      assert.equal(result.status, "PARTIAL");
      assert.equal(result.workflowSupport?.supportLevel, "SAVE_ONLY");
      assert.equal(result.steps[0]?.action, "SAVE_PAGE");
      assert.equal(result.steps[0]?.status, "VERIFIED");
      assert.equal(result.steps[1]?.action, "STOP_FOR_REVIEW");
      assert.equal(result.operatorCheckpoint?.required, true);
    },
  },
  {
    name: "save-capable workflows block mutation when step budget cannot preserve review handoff",
    run: async () => {
      const success = new FakeNode("saved", false, true, "Plan of care saved");
      const dirty = new FakeNode("unsaved", true, true, "Unsaved changes");
      const saveButton = new FakeNode("Save POC", true, true, null, () => {
        success.visible = true;
        dirty.visible = false;
      });
      const page = new FakeWorkflowPage({
        'button[data-testid="poc-save"]': [saveButton],
        '[data-testid="poc-save-success"]': [success],
        '[data-testid="unsaved-changes"]': [dirty],
      }, [saveButton], "https://example.test/documents/planofcare/456");

      const result = await executeWorkflowCompletion({
        ...buildBaseInput({
          page,
          currentDocumentKind: "PLAN_OF_CARE",
        }),
        config: resolveWorkflowExecutionConfig({
          safetyMode: "CONTROLLED_WRITE",
          workflowEnabled: true,
          workflowMode: "EXECUTE",
          allowedWorkflowActions: ["SAVE_PAGE"],
          requireOperatorCheckpointFor: [],
          maxWorkflowStepsPerRun: 1,
        }),
      });

      assert.equal(result.status, "BLOCKED");
      assert.equal(result.operatorCheckpoint?.required, true);
      assert.equal(result.steps[0]?.action, "SAVE_PAGE");
      assert.equal(result.steps[0]?.status, "BLOCKED");
      assert.equal(result.plan?.steps.some((step) => step.action === "STOP_FOR_REVIEW"), true);
    },
  },
  {
    name: "order-family workflows remain planned-only and surface episode review checkpoints",
    run: async () => {
      const result = await executeWorkflowCompletion({
        ...buildBaseInput({
          page: null,
          currentDocumentKind: "ADMISSION_ORDER",
          targetField: "orderSummary",
          humanReviewReasons: ["EPISODE_ASSOCIATION_REVIEW_REQUIRED"],
        }),
        config: resolveWorkflowExecutionConfig({
          safetyMode: "CONTROLLED_WRITE",
          workflowEnabled: true,
          workflowMode: "EXECUTE",
        }),
      });

      assert.equal(result.status, "PLANNED_ONLY");
      assert.equal(result.workflowSupport?.supportLevel, "PLANNED_ONLY");
      assert.deepEqual(result.plan?.steps.map((step) => step.action), ["STOP_FOR_REVIEW"]);
      assert.equal(result.operatorCheckpoint?.category, "EPISODE_ASSOCIATION_REVIEW");
      assert.equal(result.guardFailures.includes("SUPPORT_LEVEL_PLANNED_ONLY"), true);
    },
  },
];

let passed = 0;

async function main(): Promise<void> {
  for (const entry of tests) {
    await entry.run();
    passed += 1;
  }

  console.log(`workflow-executor tests passed: ${passed}/${tests.length}`);
}

void main();
