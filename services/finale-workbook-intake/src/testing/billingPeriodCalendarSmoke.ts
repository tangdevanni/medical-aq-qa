import { chromium } from "@playwright/test";
import { pino } from "pino";
import { parseBillingPeriodCalendar } from "../oasis/calendar/billingPeriodCalendarParser";

async function main(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`
    <html>
      <body>
        <main>
          <div class="client_calendar">
            <div class="week-row">
              <div class="calendar-day green-day" data-date="2026-03-01">
                <div class="calendar-date">03/01/2026</div>
                <div class="card-wrap ng-star-inserted">OASIS</div>
                <div class="card-wrap ng-star-inserted">SN Visit 9:00 AM</div>
              </div>
              <div class="calendar-day blue-day" data-date="2026-04-05">
                <div class="calendar-date">04/05/2026</div>
                <div class="card-wrap ng-star-inserted">PT Visit</div>
                <div class="card-wrap ng-star-inserted">Phys. Order</div>
              </div>
              <div class="calendar-day" data-date="2026-05-01">
                <div class="calendar-date">05/01/2026</div>
                <div class="card-wrap ng-star-inserted">Admin Pay</div>
              </div>
            </div>
          </div>
        </main>
      </body>
    </html>
    `);

    const result = await parseBillingPeriodCalendar({
      page,
      logger: pino({ level: "silent" }),
      context: {
        batchId: "smoke-batch",
        patientRunId: "smoke-run",
        workflowDomain: "qa",
        patientName: "Jane Doe",
        patientId: "PT-SMOKE-1",
        chartUrl: "https://demo.portal/provider/branch/client/PT-SMOKE-1/intake",
        dashboardUrl: "https://demo.portal/provider/branch/dashboard",
        resolvedAt: new Date().toISOString(),
      },
      outputDirectory: "C:/dev/medical-aq-qa/artifacts/smoke-calendar",
      selectedEpisode: {
        rawLabel: "03/01/2026 - 04/29/2026",
        startDate: "03/01/2026",
        endDate: "04/29/2026",
        isSelected: true,
      },
    });

    console.log(JSON.stringify({
      selectedEpisode: result.summary.selectedEpisode,
      first30TotalCards: result.summary.periods.first30Days.totalCards,
      second30TotalCards: result.summary.periods.second30Days.totalCards,
      outsideTotalCards: result.summary.periods.outsideRange.totalCards,
      countsByTypeFirst30: result.summary.periods.first30Days.countsByType,
      countsByTypeSecond30: result.summary.periods.second30Days.countsByType,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

void main().finally(() => {
  process.exit(0);
});
