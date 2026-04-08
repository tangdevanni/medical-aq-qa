import type { PortalSelectorCandidate } from "./types";

export const chartCalendarSelectors: {
  calendarRootSelectors: PortalSelectorCandidate[];
  pageMarkers: PortalSelectorCandidate[];
  headerSelectors: PortalSelectorCandidate[];
  weekRowSelectors: PortalSelectorCandidate[];
  dayCellSelectors: PortalSelectorCandidate[];
  dateLabelSelectors: PortalSelectorCandidate[];
  weekdayHeaderSelectors: PortalSelectorCandidate[];
  tileSelectors: PortalSelectorCandidate[];
} = {
  calendarRootSelectors: [
    {
      strategy: "css",
      selector: '[class*="calendar"], [class*="client_calendar"], [role="grid"], table',
      description: "Calendar root by grid/calendar container selectors",
    },
    {
      strategy: "css",
      selector: "main",
      description: "Calendar root main container fallback",
    },
  ],
  pageMarkers: [
    {
      strategy: "text",
      value: /calendar|episode|visit frequency|soc|start of care/i,
      description: "Calendar page marker by visible chart/calendar text",
    },
    {
      strategy: "css",
      selector: '[class*="calendar"], [class*="episode"], [class*="client_calendar"]',
      description: "Calendar page marker by class fragments",
    },
    {
      strategy: "css",
      selector: '[class*="card-wrap"], [class*="slot-event-card"], [class*="plot-container"]',
      description: "Calendar page marker by visible event-card wrappers",
    },
  ],
  headerSelectors: [
    {
      strategy: "css",
      selector: 'main [class*="header"][class*="episode"], main [class*="episode"][class*="header"]',
      description: "Calendar chart header by episode/header class fragments",
    },
    {
      strategy: "css",
      selector: 'main [class*="summary"], main [class*="header"], main [class*="episode"]',
      description: "Calendar chart header by summary/header/episode fragments",
    },
    {
      strategy: "css",
      selector: "main",
      description: "Calendar main container fallback",
    },
  ],
  weekRowSelectors: [
    {
      strategy: "css",
      selector: '[class*="week"][class*="row"], [class*="week-row"], [role="rowgroup"] [role="row"]',
      description: "Calendar week rows by class fragments or ARIA rows",
    },
    {
      strategy: "css",
      selector: "table tbody tr",
      description: "Calendar week rows by table body rows",
    },
    {
      strategy: "css",
      selector: '[class*="week"]',
      description: "Calendar week rows by generic week class",
    },
  ],
  dayCellSelectors: [
    {
      strategy: "css",
      selector: '[role="gridcell"], td, [class*="day"][class*="cell"], [class*="day-column"], [class*="calendar-day"]',
      description: "Calendar day cells by ARIA/table/day class selectors",
    },
  ],
  dateLabelSelectors: [
    {
      strategy: "css",
      selector: '[class*="date"], [class*="day-number"], [class*="cell-date"], [class*="calendar-date"]',
      description: "Calendar date label by date/day class fragments",
    },
    {
      strategy: "css",
      selector: 'time, [data-date], [aria-label*="202"], [aria-label*="Jan"], [aria-label*="Feb"], [aria-label*="Mar"], [aria-label*="Apr"], [aria-label*="May"], [aria-label*="Jun"], [aria-label*="Jul"], [aria-label*="Aug"], [aria-label*="Sep"], [aria-label*="Oct"], [aria-label*="Nov"], [aria-label*="Dec"]',
      description: "Calendar date label by time/data-date/aria-label fallback",
    },
  ],
  weekdayHeaderSelectors: [
    {
      strategy: "css",
      selector: '[role="columnheader"], thead th, [class*="weekday"], [class*="day-header"]',
      description: "Calendar weekday headers by ARIA/table/header selectors",
    },
  ],
  tileSelectors: [
    {
      strategy: "css",
      selector: '[class*="card-wrap"][class*="ng-star-inserted"]',
      description: "Calendar event tiles by card-wrap wrapper",
    },
    {
      strategy: "css",
      selector: '[class*="slot-event-card"]',
      description: "Calendar event tiles by slot-event-card class",
    },
    {
      strategy: "css",
      selector: '[class*="plot-container"][class*="cardcontainer-info-event"]',
      description: "Calendar event tiles by plot-container card class",
    },
    {
      strategy: "css",
      selector: '[popoverclass*="client_calendar"]',
      description: "Calendar event tiles by client_calendar popover class",
    },
    {
      strategy: "css",
      selector: '[cdkdrag], [class*="cdk-drag"]',
      description: "Calendar event tiles by drag wrappers",
    },
  ],
};
