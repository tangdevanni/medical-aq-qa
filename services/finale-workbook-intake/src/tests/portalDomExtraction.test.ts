import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "@playwright/test";
import {
  buildOasisDomBridgeText,
  buildOasisDomComparisonArtifact,
  persistOasisDomAcquisitionArtifacts,
} from "../portal/domExtraction/oasisDomBridge";
import { extractOasisDomStateFromPage } from "../portal/domExtraction/oasisDomExtraction";
import { extractPortalDomStateFromPage } from "../portal/domExtraction/portalDomExtraction";
import { extractVisitNoteDomStateFromCurrentPage } from "../portal/domExtraction/visitNotesDomExtraction";

describe("portal DOM extraction", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it("extracts structured form controls, tables, and stable hashes without scripts", async () => {
    await page.setContent(`
      <form>
        <h2>Assessment</h2>
        <script>window.token = "secret-token";</script>
        <label for="bp">Blood Pressure</label>
        <input id="bp" name="bloodPressure" value="120/80" />
        <label for="readonly">Readonly Field</label>
        <input id="readonly" readonly value="readonly value" />
        <div style="height: fit-content" id="m0010" class="form-body m0010 show-component">
          <h6 class="form-section rounded-corner">(M0010) Agency Medicare Provider Number</h6>
          <label for="disabled">Disabled Field</label>
          <input id="disabled" name="noteLabel" disabled value="disabled value" />
        </div>
        <label for="narrative">Narrative</label>
        <textarea id="narrative">Patient tolerated gait training.</textarea>
        <label id="rich-label">Skilled Intervention Summary</label>
        <div class="ql-editor" role="textbox" aria-labelledby="rich-label" contenteditable="true">
          Patient completed 75 ft gait training with FWW and vc/tc.
        </div>
        <label for="discipline">Discipline</label>
        <select id="discipline"><option>RN</option><option selected>PT</option></select>
        <div class="inputGroup-radio-loader m0080_assessor_discipline disable-ctrl selected">
          <input type="radio" id="M0080_ASSESSOR_DISCIPLINE-1-02" name="M0080_ASSESSOR_DISCIPLINE" disabled value="PT" />
          <label for="M0080_ASSESSOR_DISCIPLINE-1-02">PT</label>
        </div>
        <label><input type="radio" name="homebound" value="yes" checked /> Yes</label>
        <label><input type="radio" name="homebound" value="no" /> No</label>
        <div class="inputGroup-radio-loader m0032_roc_dt_na disable-ctrl selected">
          <input type="checkbox" id="M0032_ROC_DT_NA-1" name="M0032_ROC_DT_NA" disabled />
          <label for="M0032_ROC_DT_NA-1">NA</label>
        </div>
        <label><input type="checkbox" name="fallRisk" checked /> Fall risk</label>
        <label><input type="checkbox" name="oxygen" /> Oxygen</label>
        <table aria-label="Vitals"><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody><tr><td>Pulse</td><td>72</td></tr></tbody></table>
      </form>
    `);

    const first = await extractPortalDomStateFromPage(page, {
      sourceArea: "oasis",
      sectionTitle: "Assessment",
      minFieldCount: 7,
      minNonEmptyFieldCount: 5,
    });
    const second = await extractPortalDomStateFromPage(page, {
      sourceArea: "oasis",
      sectionTitle: "Assessment",
      minFieldCount: 7,
      minNonEmptyFieldCount: 5,
    });

    expect(first.artifactType).toBe("portal_dom_extracted_state");
    expect(first.coverage.fieldCount).toBeGreaterThanOrEqual(7);
    expect(first.coverage.nonEmptyFieldCount).toBeGreaterThanOrEqual(5);
    expect(first.coverage.tableCount).toBe(1);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.textDigest).toContain("Blood Pressure");
    expect(first.textDigest).toContain("Patient tolerated gait training");
    expect(first.textDigest).toContain("Patient completed 75 ft gait training with FWW");
    expect(first.textDigest).not.toContain("secret-token");
    expect(first.sections[0]?.fields.some((field) => field.inputType === "richtext" && field.value === "Patient completed 75 ft gait training with FWW and vc/tc.")).toBe(true);
    expect(first.sections[0]?.fields.some((field) => field.sourceKind === "checkbox" && field.checked === false)).toBe(true);
    expect(first.sections[0]?.fields.some((field) => field.itemCode === "M0010" && field.value === "disabled value")).toBe(true);
    expect(first.sections[0]?.fields.some((field) => field.itemCode === "M0032" && field.checked === true)).toBe(true);
    expect(first.sections[0]?.fields.some((field) => field.itemCode === "M0080" && field.checked === true)).toBe(true);
    expect(first.sections[0]?.fields.some((field) => /Agency Medicare Provider Number/.test(field.label ?? ""))).toBe(true);
  });

  it("preserves blank table cells so row values stay aligned to headers", async () => {
    await page.setContent(`
      <section>
        <h2>Medication & Allergies</h2>
        <table aria-label="Medication List">
          <thead>
            <tr><th>Medication</th><th>Dose</th><th>Route</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr><td>Metformin</td><td>500 mg</td><td></td><td>Active</td></tr>
            <tr><td>Furosemide</td><td></td><td>Oral</td><td>Active</td></tr>
          </tbody>
        </table>
      </section>
    `);

    const result = await extractPortalDomStateFromPage(page, {
      sourceArea: "oasis",
      sectionTitle: "Medication & Allergies",
      minFieldCount: 0,
      minNonEmptyFieldCount: 0,
    });

    const rows = result.sections[0]?.tables[0]?.rows ?? [];
    expect(rows).toContainEqual(["Metformin", "500 mg", "", "Active"]);
    expect(rows).toContainEqual(["Furosemide", "", "Oral", "Active"]);
  });

  it("iterates every OASIS ng-select section and continues after a degraded section", async () => {
    await page.setContent(`
      <app-document-note>
        <app-oasis>
          <fin-select class="select-oasis-pages">
            <ng-select class="fin-select ng-select ng-select-single">
              <div class="ng-select-container"><div class="ng-value-container"><div class="ng-value">Administrative</div><div class="ng-input"><input role="combobox" /></div></div></div>
            </ng-select>
          </fin-select>
          <section id="content">
            <h2>Administrative</h2>
            <label for="soc">SOC Date</label><input id="soc" value="05/01/2026" />
          </section>
        </app-oasis>
      </app-document-note>
      <script>
        const sections = {
          "Administrative": '<h2>Administrative</h2><label for="soc">SOC Date</label><input id="soc" value="05/01/2026" />',
          "Vitals": '<h2>Vitals</h2><label for="bp2">Blood Pressure</label><input id="bp2" value="118/76" /><table><tr><th>Metric</th><th>Value</th></tr><tr><td>Pulse</td><td>78</td></tr></table>',
          "Blank": '<h2>Blank</h2><p>Loading shell only</p>',
          "Care Plan: Problems / Goals / Interventions": '<h2>Care Plan</h2><label for="goal">Goal</label><input id="goal" value="Deferred mapping" />'
        };
        document.querySelector('ng-select').addEventListener('click', () => {
          let panel = document.querySelector('ng-dropdown-panel');
          if (panel) return;
          panel = document.createElement('ng-dropdown-panel');
          panel.className = 'ng-dropdown-panel ng-select-bottom';
          panel.innerHTML = '<div role="listbox" class="ng-dropdown-panel-items scroll-host">' +
            Object.keys(sections).map((name, index) => '<div class="ng-option' + (index === 0 ? ' ng-option-selected' : '') + '" role="option" aria-selected="' + (index === 0) + '"><span class="ng-option-label">' + name + '</span></div>').join('') +
            '<div class="ng-option" role="option"><span class="ng-option-label"></span></div>' +
            '</div>';
          document.body.appendChild(panel);
          panel.querySelectorAll('.ng-option').forEach((option) => option.addEventListener('click', () => {
            const label = option.textContent.trim();
            document.querySelector('.ng-value').textContent = label;
            document.querySelector('#content').innerHTML = sections[label] || '';
            panel.remove();
          }));
        });
      </script>
    `);

    const result = await extractOasisDomStateFromPage({
      page,
      thresholds: {
        minFieldCount: 2,
        minNonEmptyFieldCount: 2,
      },
    });

    expect(result.sectionResults.map((section) => section.label)).toEqual([
      "Administrative",
      "Vitals",
      "Blank",
      "Care Plan: Problems / Goals / Interventions",
    ]);
    expect(result.state.sections).toHaveLength(4);
    expect(result.state.sections.find((section) => section.title === "Vitals")?.tables).toHaveLength(1);
    expect(result.state.sections.find((section) => section.title === "Blank")?.status).toBe("degraded");
    expect(result.state.sections.find((section) => section.title.includes("Care Plan"))?.status).toBe("success");
    expect(result.state.sections.find((section) => section.title.includes("Care Plan"))?.fields[0]?.value).toBe("Deferred mapping");
    expect(result.state.coverage.fallbackReasons).not.toContain("care_plan_deferred_for_later_mapping");
    expect(result.state.coverage.fallbackRecommended).toBe(true);
  }, 10_000);

  it("captures screenshot-style care plan goals from goal-content pre blocks", async () => {
    const goalText = "Improve TUG score to 12 seconds or better to improve fall safety.";
    await page.setContent(`
      <app-document-note>
        <app-oasis>
          <fin-select class="select-oasis-pages">
            <ng-select class="fin-select ng-select ng-select-single">
              <div class="ng-select-container"><div class="ng-value-container"><div class="ng-value">Care Plan: Problems / Goals / Interventions</div><div class="ng-input"><input role="combobox" /></div></div></div>
            </ng-select>
          </fin-select>
          <section id="content">
            <div class="careplan-summary">
              <div class="careplan-summary__header-label">PT Balance Training - The patient currently demonstrates a high risk for falls with all functional mobility, as demonstrated by TUG score of 16 secs</div>
              <div class="careplan-summary__goal-count_status-unmet">0/1 Met Goal(s)</div>
              <div class="careplan-summary__goal-content">
                <div class="careplan-summary__goal-content-header">
                  <div class="careplan-summary__goal-title"><span class="font-bold">Goal</span></div>
                  <pre>${goalText}</pre>
                </div>
              </div>
              <div>Target Completion: 3 Week(s) Term: Short-term Status: Unmet Onset: 05/09/2026 Source: 05/09/2026 - 07/07/2026</div>
            </div>
          </section>
        </app-oasis>
      </app-document-note>
      <script>
        window.__carePlanGoalSections = {
          "Care Plan: Problems / Goals / Interventions": document.querySelector('#content').innerHTML
        };
        document.querySelector('ng-select').addEventListener('click', () => {
          let panel = document.querySelector('ng-dropdown-panel');
          if (panel) return;
          panel = document.createElement('ng-dropdown-panel');
          panel.className = 'ng-dropdown-panel ng-select-bottom';
          panel.innerHTML = '<div role="listbox" class="ng-dropdown-panel-items scroll-host">' +
            '<div class="ng-option ng-option-selected" role="option" aria-selected="true"><span class="ng-option-label">Care Plan: Problems / Goals / Interventions</span></div>' +
            '</div>';
          document.body.appendChild(panel);
          panel.querySelectorAll('.ng-option').forEach((option) => option.addEventListener('click', () => {
            const label = option.textContent.trim();
            document.querySelector('.ng-value').textContent = label;
            document.querySelector('#content').innerHTML = window.__carePlanGoalSections[label] || '';
            panel.remove();
          }));
        });
      </script>
    `);

    const result = await extractOasisDomStateFromPage({
      page,
      thresholds: {
        minFieldCount: 2,
        minNonEmptyFieldCount: 2,
      },
    });
    const carePlan = result.state.sections.find((section) => section.title.includes("Care Plan"));

    expect(carePlan?.status).toBe("success");
    expect(carePlan?.tables[0]?.rows[0]?.[2]).toBe(goalText);
    expect(carePlan?.fields.find((field) => field.key === "care_plan_problem_1_goal")?.value).toBe(goalText);
  }, 10_000);

  it("builds deterministic OASIS bridge text and comparison artifacts against mocked baseline", async () => {
    await page.setContent(`
      <form>
        <h1>Active Diagnoses</h1>
        <div id="m1021" class="form-body m1021">
          <h6>(M1021) Primary Diagnosis</h6>
          <label for="dx">Primary Diagnosis</label>
          <input id="dx" name="M1021_PRIMARY_DIAGNOSIS" disabled value="I50.9 Heart failure" />
        </div>
        <h1>Functional Assessment / Mobility & Musculoskeletal</h1>
        <div id="gg0170" class="form-body gg0170">
          <h6>(GG0170) Mobility</h6>
          <label><input type="checkbox" checked /> Uses walker for ambulation</label>
        </div>
      </form>
    `);
    const state = await extractPortalDomStateFromPage(page, {
      sourceArea: "oasis",
      sectionTitle: "Active Diagnoses",
      minFieldCount: 2,
      minNonEmptyFieldCount: 2,
    });
    const bridgeText = buildOasisDomBridgeText(state);
    expect(bridgeText).toContain("OASIS DOM EXTRACTED STATE");
    expect(bridgeText).toContain("(M1021)");
    expect(bridgeText).toContain("I50.9 Heart failure");
    expect(bridgeText).not.toContain("<input");

    const directory = await mkdtemp(path.join(os.tmpdir(), "oasis-dom-comparison-"));
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "oasis-printed-note-review.json"),
        JSON.stringify({
          reviewSource: "printed_note_ocr",
          sections: [{ label: "Active Diagnoses", evidence: ["M1021 Primary Diagnosis I50.9 Heart failure"] }],
        }),
        "utf8",
      );
      const comparison = await buildOasisDomComparisonArtifact({
        state,
        patientArtifactsDirectory: directory,
        patientCase: "patient-run-test",
      });
      expect(comparison.baselineSource).toContain("oasis-printed-note-review.json");
      expect(comparison.fieldCoverage.overlappingItemCodes).toContain("M1021");
      expect(comparison.recommendedDecision).not.toBe("dom_not_ready");

      const persisted = await persistOasisDomAcquisitionArtifacts({
        state,
        patientArtifactsDirectory: directory,
        patientCase: "patient-run-test",
      });
      expect(await readFile(persisted.bridgeTextPath, "utf8")).toContain("M1021");
      expect(persisted.comparisonPath).toContain("oasis-dom-vs-existing-extraction-comparison.json");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("extracts a current Visit Note form and recommends fallback when clinical cues are missing", async () => {
    await page.setContent(`
      <form>
        <h1>Visit Note - PT</h1>
        <label for="date">Note Date</label><input id="date" value="05/02/2026" />
        <label for="vitals">Vitals</label><textarea id="vitals">BP 122/80, pulse 74.</textarea>
        <label><input type="checkbox" checked /> Gait training completed</label>
        <label for="response">Response</label><textarea id="response">Patient tolerated interventions.</textarea>
      </form>
    `);

    const state = await extractVisitNoteDomStateFromCurrentPage({
      page,
      thresholds: {
        minFieldCount: 4,
        minNonEmptyFieldCount: 3,
      },
    });

    expect(state.sourceArea).toBe("visit_notes");
    expect(state.coverage.nonEmptyFieldCount).toBeGreaterThanOrEqual(3);
    expect(state.textDigest).toContain("Gait training");
    expect(state.coverage.fallbackReasons).not.toContain("visit_note_clinical_cues_not_found");
  });
});
