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

  it("captures OASIS radio selected values, all options, zero responses, and full GG suffixes", async () => {
    await page.setContent(`
      <section>
        <h2>Functional Assessment (Self Care)</h2>
        <div class="form-body m1800">
          <h6>(M1800) Grooming:</h6>
          <p>Current ability to tend safely to personal hygiene needs</p>
          <label><input type="radio" name="M1800" value="0" /> 0. Able to groom self unaided.</label>
          <label class="inputGroup-radio-loader selected"><input type="radio" name="M1800" value="1" checked /> 1. Grooming utensils must be placed within reach before able to complete grooming activities.</label>
          <label><input type="radio" name="M1800" value="2" /> 2. Someone must assist the patient to groom self.</label>
          <label><input type="radio" name="M1800" value="3" /> 3. Patient depends entirely upon someone else for grooming needs</label>
        </div>
        <div class="form-body m1810">
          <h6>(M1810) Ability to Dress Upper Body:</h6>
          <label class="selected"><input type="radio" name="M1810" value="0" checked /> 0. Able to get clothes out of closets and drawers, put them on and remove them without assistance.</label>
          <label><input type="radio" name="M1810" value="1" /> 1. Able to dress upper body without assistance if clothing is laid out or handed to the patient.</label>
          <label><input type="radio" name="M1810" value="2" /> 2. Someone must help the patient put on upper body clothing.</label>
        </div>
        <div class="form-body gg0170c">
          <h6>(GG0170C) Mobility - Lying to sitting on side of bed</h6>
          <label><input type="radio" name="GG0170C" value="01" /> 01. Dependent</label>
          <label><input type="radio" name="GG0170C" value="04" checked /> 04. Supervision or touching assistance</label>
          <label><input type="radio" name="GG0170C" value="06" /> 06. Independent</label>
        </div>
      </section>
    `);

    const result = await extractPortalDomStateFromPage(page, {
      sourceArea: "oasis",
      sectionTitle: "Functional Assessment (Self Care)",
      minFieldCount: 3,
      minNonEmptyFieldCount: 3,
    });

    const fields = result.sections[0]?.fields ?? [];
    const grooming = fields.find((field) => field.itemCode === "M1800");
    const dressing = fields.find((field) => field.itemCode === "M1810");
    const gg = fields.find((field) => field.itemCode === "GG0170C");

    expect(grooming?.selectedValue).toBe("1");
    expect(grooming?.selectedText).toContain("Grooming utensils must be placed within reach");
    expect(grooming?.optionTexts).toEqual(expect.arrayContaining([
      "0. Able to groom self unaided.",
      "1. Grooming utensils must be placed within reach before able to complete grooming activities.",
      "2. Someone must assist the patient to groom self.",
      "3. Patient depends entirely upon someone else for grooming needs",
    ]));
    expect(dressing?.selectedValue).toBe("0");
    expect(dressing?.selectedText).toContain("0. Able to get clothes out of closets");
    expect(gg?.itemCode).toBe("GG0170C");
    expect(gg?.selectedValue).toBe("04");
    expect(gg?.optionTexts).toEqual(expect.arrayContaining([
      "01. Dependent",
      "04. Supervision or touching assistance",
      "06. Independent",
    ]));
  });

  it("captures Finale styled hidden OASIS radio controls", async () => {
    await page.setContent(`
      <section>
        <h2>Functional Assessment (Self Care)</h2>
        <style>
          .inputGroup-radio-loader input { display: none; }
        </style>
        <div class="form-body m1800">
          <h6>(M1800) Grooming:</h6>
          <div class="inputGroup-radio-loader">
            <input type="radio" id="M1800-0" name="M1800" value="0" />
            <label for="M1800-0">0. Able to groom self unaided, with or without the use of assistive devices or adapted methods.</label>
          </div>
          <div class="inputGroup-radio-loader selected">
            <input type="radio" id="M1800-1" name="M1800" value="1" />
            <label for="M1800-1">1. Grooming utensils must be placed within reach before able to complete grooming activities.</label>
          </div>
          <div class="inputGroup-radio-loader">
            <input type="radio" id="M1800-2" name="M1800" value="2" />
            <label for="M1800-2">2. Someone must assist the patient to groom self.</label>
          </div>
        </div>
        <div class="form-body gg0170c">
          <h6>(GG0170C) C. Lying to sitting on side of bed:</h6>
          <div class="inputGroup-radio-loader">
            <input type="radio" id="GG0170C-01" name="GG0170C" value="01" />
            <label for="GG0170C-01">01. Dependent</label>
          </div>
          <div class="inputGroup-radio-loader selected">
            <input type="radio" id="GG0170C-04" name="GG0170C" value="04" />
            <label for="GG0170C-04">04. Supervision or touching assistance</label>
          </div>
          <div class="inputGroup-radio-loader">
            <input type="radio" id="GG0170C-06" name="GG0170C" value="06" />
            <label for="GG0170C-06">06. Independent</label>
          </div>
        </div>
      </section>
    `);

    const result = await extractPortalDomStateFromPage(page, {
      sourceArea: "oasis",
      sectionTitle: "Functional Assessment (Self Care)",
      minFieldCount: 2,
      minNonEmptyFieldCount: 2,
    });

    const fields = result.sections[0]?.fields ?? [];
    const grooming = fields.find((field) => field.itemCode === "M1800");
    const gg = fields.find((field) => field.itemCode === "GG0170C");

    expect(grooming).toMatchObject({
      inputType: "radio",
      selectedValue: "1",
      checked: true,
    });
    expect(grooming?.selectedText).toContain("Grooming utensils must be placed within reach");
    expect(grooming?.optionTexts).toEqual(expect.arrayContaining([
      "0. Able to groom self unaided, with or without the use of assistive devices or adapted methods.",
      "1. Grooming utensils must be placed within reach before able to complete grooming activities.",
      "2. Someone must assist the patient to groom self.",
    ]));
    expect(gg).toMatchObject({
      inputType: "radio",
      itemCode: "GG0170C",
      selectedValue: "04",
      checked: true,
    });
    expect(gg?.selectedText).toBe("04. Supervision or touching assistance");
  });

  it("groups live Finale OASIS radios by ID prefix when name/value attributes are missing", async () => {
    await page.setContent(`
      <section>
        <h2>Functional Assessment (Self Care)</h2>
        <div class="form-body m1800">
          <h6>(M1800) Grooming:</h6>
          <div class="inputGroup-radio-loader">
            <input type="radio" id="M1800_CRNT_GROOMING-1-00" />
            0. Able to groom self unaided, with or without the use of assistive devices or adapted methods.
          </div>
          <div class="inputGroup-radio-loader">
            <input type="radio" id="M1800_CRNT_GROOMING-2-01" />
            1. Grooming utensils must be placed within reach before able to complete grooming activities.
          </div>
          <div class="inputGroup-radio-loader">
            <input type="radio" id="M1800_CRNT_GROOMING-3-02" checked />
            2. Someone must assist the patient to groom self.
          </div>
        </div>
        <div class="form-body gg0130a">
          <h6>(GG0130A1) Eating</h6>
          <div class="inputGroup-radio-loader">
            <input type="radio" id="GG0130A1-1-06" />
            06. Independent
          </div>
          <div class="inputGroup-radio-loader">
            <input type="radio" id="GG0130A1-2-05" checked />
            05. Setup or clean-up assistance
          </div>
          <div class="inputGroup-radio-loader">
            <input type="radio" id="GG0130A1-3-04" />
            04. Supervision or touching assistance
          </div>
        </div>
      </section>
    `);

    const result = await extractPortalDomStateFromPage(page, {
      sourceArea: "oasis",
      sectionTitle: "Functional Assessment (Self Care)",
      minFieldCount: 2,
      minNonEmptyFieldCount: 2,
    });

    const fields = result.sections[0]?.fields ?? [];
    const grooming = fields.find((field) => field.itemCode === "M1800");
    const eating = fields.find((field) => field.itemCode === "GG0130A1");

    expect(fields.filter((field) => field.itemCode === "M1800")).toHaveLength(1);
    expect(grooming).toMatchObject({
      inputType: "radio",
      selectedValue: "2",
      checked: true,
    });
    expect(grooming?.selectedText).toBe("2. Someone must assist the patient to groom self.");
    expect(grooming?.optionTexts).toEqual(expect.arrayContaining([
      "0. Able to groom self unaided, with or without the use of assistive devices or adapted methods.",
      "1. Grooming utensils must be placed within reach before able to complete grooming activities.",
      "2. Someone must assist the patient to groom self.",
    ]));
    expect(eating).toMatchObject({
      inputType: "radio",
      itemCode: "GG0130A1",
      selectedValue: "05",
      selectedText: "05. Setup or clean-up assistance",
      checked: true,
    });
    expect(eating?.optionTexts).toEqual(expect.arrayContaining([
      "06. Independent",
      "05. Setup or clean-up assistance",
      "04. Supervision or touching assistance",
    ]));
  });

  it("captures selected OASIS option rows when Finale does not expose usable inputs", async () => {
    await page.setContent(`
      <section>
        <h2>Functional Assessment (Self Care)</h2>
        <div class="form-body m1810">
          <h6>(M1810) Ability to Dress Upper Body:</h6>
          <div class="inputGroup-radio-loader">0. Able to get clothes out of closets and drawers, put them on and remove them from the upper body without assistance.</div>
          <div class="inputGroup-radio-loader selected">1. Able to dress upper body without assistance if clothing is laid out or handed to the patient.</div>
          <div class="inputGroup-radio-loader">2. Someone must help the patient put on upper body clothing.</div>
        </div>
        <div class="form-body gg0170c">
          <h6>(GG0170C) C. Lying to sitting on side of bed:</h6>
          <div class="inputGroup-radio-loader">01. Dependent</div>
          <div class="inputGroup-radio-loader selected">04. Supervision or touching assistance</div>
          <div class="inputGroup-radio-loader">06. Independent</div>
        </div>
      </section>
    `);

    const result = await extractPortalDomStateFromPage(page, {
      sourceArea: "oasis",
      sectionTitle: "Functional Assessment (Self Care)",
      minFieldCount: 2,
      minNonEmptyFieldCount: 2,
    });

    const fields = result.sections[0]?.fields ?? [];
    const dressing = fields.find((field) => field.itemCode === "M1810");
    const gg = fields.find((field) => field.itemCode === "GG0170C");

    expect(dressing).toMatchObject({
      inputType: "radio",
      selectedValue: "1",
      selectedText: "1. Able to dress upper body without assistance if clothing is laid out or handed to the patient.",
      checked: true,
    });
    expect(dressing?.optionTexts).toEqual(expect.arrayContaining([
      "0. Able to get clothes out of closets and drawers, put them on and remove them from the upper body without assistance.",
      "1. Able to dress upper body without assistance if clothing is laid out or handed to the patient.",
      "2. Someone must help the patient put on upper body clothing.",
    ]));
    expect(gg).toMatchObject({
      inputType: "radio",
      itemCode: "GG0170C",
      selectedValue: "04",
      selectedText: "04. Supervision or touching assistance",
      checked: true,
    });
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
