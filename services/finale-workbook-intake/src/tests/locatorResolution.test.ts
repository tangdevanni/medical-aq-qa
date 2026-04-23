import { describe, expect, it } from "vitest";
import {
  resolveFirstVisibleLocator,
  selectorAttemptToEvidence,
  type SelectorAttemptResult,
} from "../portal/utils/locatorResolution";
import type { PortalSelectorCandidate } from "../portal/selectors/types";

class FakeLocator {
  constructor(
    private readonly countValue: number,
    private readonly visibleIndexes: number[] = [],
    private readonly texts: string[] = [],
  ) {}

  async count() {
    return this.countValue;
  }

  first() {
    return this;
  }

  nth(index: number) {
    return new FakeLocator(
      index < this.countValue ? 1 : 0,
      this.visibleIndexes.includes(index) ? [0] : [],
      [this.texts[index] ?? this.texts[0] ?? ""],
    );
  }

  async isVisible() {
    return this.visibleIndexes.includes(0);
  }

  async getAttribute(name: string) {
    if (name === "aria-label") {
      return this.texts[0] ?? null;
    }

    return null;
  }

  async textContent() {
    return this.texts[0] ?? null;
  }
}

class FakePage {
  constructor(private readonly registry: Record<string, FakeLocator>) {}

  getByRole(role: string, options?: { name?: string | RegExp }) {
    return this.registry[`role:${role}:${String(options?.name ?? "")}`] ?? new FakeLocator(0);
  }

  getByLabel(value: string | RegExp) {
    return this.registry[`label:${String(value)}`] ?? new FakeLocator(0);
  }

  getByPlaceholder(value: string | RegExp) {
    return this.registry[`placeholder:${String(value)}`] ?? new FakeLocator(0);
  }

  getByText(value: string | RegExp) {
    return this.registry[`text:${String(value)}`] ?? new FakeLocator(0);
  }

  locator(selector: string) {
    return this.registry[`locator:${selector}`] ?? new FakeLocator(0);
  }

  async waitForTimeout() {}
}

describe("locatorResolution", () => {
  it("falls back to later selector candidates when earlier ones do not match", async () => {
    const page = new FakePage({
      "label:/patient|search/i": new FakeLocator(0),
      "placeholder:/patient|search/i": new FakeLocator(1, [0], ["Search patients"]),
    });
    const candidates: PortalSelectorCandidate[] = [
      {
        strategy: "label",
        value: /patient|search/i,
        description: "patient search by label",
      },
      {
        strategy: "placeholder",
        value: /patient|search/i,
        description: "patient search by placeholder",
      },
    ];

    const result = await resolveFirstVisibleLocator({
      page: page as never,
      candidates,
      step: "patient_search_input",
      debugConfig: {
        debugSelectors: false,
        saveDebugHtml: false,
        pauseOnFailure: false,
        stepTimeoutMs: 5_000,
        debugScreenshots: true,
        selectorRetryCount: 1,
      },
    });

    expect(result.locator).not.toBeNull();
    expect(result.matchedCandidate?.description).toBe("patient search by placeholder");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.outcome).toBe("not_found");
    expect(result.attempts[1]?.outcome).toBe("matched");
  });

  it("formats selector attempt evidence for step logs", () => {
    const attempt: SelectorAttemptResult = {
      selector: "placeholder=/patient/i :: patient search by placeholder",
      strategy: "placeholder",
      description: "patient search by placeholder",
      count: 1,
      visibleCount: 1,
      elapsedMs: 12,
      outcome: "matched",
      sampleTexts: ["Search patients"],
      errorMessage: null,
    };

    expect(selectorAttemptToEvidence(attempt)).toContain("[matched]");
    expect(selectorAttemptToEvidence(attempt)).toContain("Search patients");
  });
});
