import { chromium } from "@playwright/test";
import { pino } from "pino";
import {
  discoverEpisodeRangeOptions,
  selectEpisodeRange,
} from "../oasis/navigation/episodeRangeDropdownService";

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setContent(`
    <html>
      <body>
        <app-header-info>
          <div class="header-container">
            <ng-select id="episode-of">
              <div class="ng-select-container" onclick="window.toggleEpisodePanel()">
                <div role="combobox">
                  <span class="ng-value">
                    <span class="ng-value-label">02/27/2026 - 04/27/2026</span>
                  </span>
                  <input role="combobox" type="text" aria-autocomplete="list" />
                </div>
                <span class="ng-arrow-wrapper"></span>
              </div>
            </ng-select>
          </div>
        </app-header-info>
        <ng-dropdown-panel id="episode-panel" style="display:none;">
          <div class="ng-option ng-option-selected" aria-selected="true" onclick="window.selectEpisode('02/27/2026 - 04/27/2026')">02/27/2026 - 04/27/2026</div>
          <div class="ng-option" aria-selected="false" onclick="window.selectEpisode('04/28/2026 - 06/26/2026')">04/28/2026 - 06/26/2026</div>
          <div class="ng-option" aria-selected="false" onclick="window.selectEpisode('06/27/2026 - 08/25/2026')">06/27/2026 - 08/25/2026</div>
        </ng-dropdown-panel>
        <script>
          window.toggleEpisodePanel = function () {
            const panel = document.getElementById("episode-panel");
            panel.style.display = panel.style.display === "none" ? "block" : "none";
          };
          window.selectEpisode = function (value) {
            document.querySelector(".ng-value-label").textContent = value;
            document.querySelectorAll("#episode-panel .ng-option").forEach((option) => {
              const selected = option.textContent.trim() === value;
              option.setAttribute("aria-selected", selected ? "true" : "false");
              option.className = selected ? "ng-option ng-option-selected" : "ng-option";
            });
            document.getElementById("episode-panel").style.display = "none";
          };
        </script>
      </body>
    </html>
  `);

  const context = {
    batchId: "smoke-batch",
    patientRunId: "smoke-run",
    workflowDomain: "qa" as const,
    patientName: "Jane Doe",
    patientId: "PT-SMOKE-1",
    chartUrl: "https://demo.portal/provider/branch/client/PT-SMOKE-1/intake",
    dashboardUrl: "https://demo.portal/provider/branch/dashboard",
    resolvedAt: new Date().toISOString(),
  };

  const discovery = await discoverEpisodeRangeOptions({
    page,
    logger: pino({ level: "silent" }),
    context,
  });
  const selection = await selectEpisodeRange({
    page,
    logger: pino({ level: "silent" }),
    context,
    target: {
      startDate: "04/28/2026",
      endDate: "06/26/2026",
      required: true,
    },
  });

  console.log(JSON.stringify({
    currentSelection: discovery.discovery.currentSelection,
    availableOptions: discovery.discovery.availableOptions,
    selectedOption: selection.result.selectedOption,
    changedSelection: selection.result.changedSelection,
    selectionMethod: selection.result.selectionMethod,
  }, null, 2));

  await browser.close();
}

void main();
