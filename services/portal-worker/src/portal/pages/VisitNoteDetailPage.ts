import {
  type PortalButtonSummary,
  qaQueueItemDetailSurfaceSchema,
  type QaQueueItemDetailSurface,
} from "@medical-ai-qa/shared-types";
import { type Page } from "@playwright/test";
import { buildButtonSummary, sanitizeStructuralLabel } from "../discovery/control-classification";
import { VISIT_NOTE_DETAIL_SELECTORS } from "../selectors/visit-note-detail.selectors";
import { PortalDiscoveryPage } from "./PortalDiscoveryPage";
import {
  collectVisibleTextsFromSelectors,
  hasVisibleLocator,
  normalizeText,
} from "../utils/page-helpers";
import { extractDocument } from "../../extractors/extractDocument";
import { extractVisitNoteSnapshot } from "../../extractors/visitNoteExtractor";
import { buildVisitNoteQaReport } from "../../rules/visitNoteQaRules";
import { type VisitNoteExtractorOptions, type VisitNoteQaReport } from "../../types/visitNoteQa";

export class VisitNoteDetailPage {
  private readonly discoveryPage: PortalDiscoveryPage;

  constructor(private readonly page: Page) {
    this.discoveryPage = new PortalDiscoveryPage(page);
  }

  async isLoaded(): Promise<boolean> {
    const url = this.page.url();
    if (
      VISIT_NOTE_DETAIL_SELECTORS.detailUrlPattern.test(url) ||
      VISIT_NOTE_DETAIL_SELECTORS.orderDetailUrlPattern.test(url)
    ) {
      return true;
    }

    const [hasMarkers, hasVisitIndicators, hasOrderIndicators, hasOasisIndicators, hasPlanOfCareIndicators, sectionHeaders, textareasPresent] = await Promise.all([
      hasVisibleLocator(this.page, VISIT_NOTE_DETAIL_SELECTORS.detailMarkers, 1_500),
      hasVisibleLocator(this.page, VISIT_NOTE_DETAIL_SELECTORS.visitNoteIndicators, 1_500),
      hasVisibleLocator(this.page, VISIT_NOTE_DETAIL_SELECTORS.orderIndicators, 1_500),
      hasVisibleLocator(this.page, ['text=/oasis|clinical assessment|functional status/i'], 1_500),
      hasVisibleLocator(this.page, ['text=/plan of care|certification period|homebound/i'], 1_500),
      this.getSectionHeaders(),
      this.hasTextAreas(),
    ]);

    return hasMarkers || hasVisitIndicators || hasOrderIndicators || hasOasisIndicators || hasPlanOfCareIndicators || sectionHeaders.length > 0 || textareasPresent;
  }

  async mapSurface(detected: boolean): Promise<QaQueueItemDetailSurface> {
    if (!detected) {
      return qaQueueItemDetailSurfaceSchema.parse({
        detected: false,
        pageType: "unknown",
        url: null,
        title: null,
        tabs: [],
        sectionHeaders: [],
        fieldLabels: [],
        buttons: [],
        attachmentsPresent: false,
        textareasPresent: false,
        statusAreasPresent: false,
        layoutPatterns: [],
      });
    }

    const observation = await this.discoveryPage.discoverDestinationPage({
      opened: true,
      openBehavior: "same_page",
    });
    const [fieldLabels, buttons, attachmentsPresent, textareasPresent, statusAreasPresent, hasVisitIndicators, hasOrderIndicators] =
      await Promise.all([
        this.getFieldLabels(),
        this.getButtons(),
        this.hasAttachments(),
        this.hasTextAreas(),
        this.hasStatusAreas(),
        hasVisibleLocator(this.page, VISIT_NOTE_DETAIL_SELECTORS.visitNoteIndicators, 1_000),
        hasVisibleLocator(this.page, VISIT_NOTE_DETAIL_SELECTORS.orderIndicators, 1_000),
      ]);

    return qaQueueItemDetailSurfaceSchema.parse({
      detected: true,
      pageType: classifyDetailPageType({
        url: observation.url,
        title: observation.title,
        sectionHeaders: observation.sectionHeaders,
        fieldLabels,
        textareasPresent,
        hasVisitIndicators,
        hasOrderIndicators,
      }),
      url: observation.url,
      title: observation.title,
      tabs: observation.tabs,
      sectionHeaders: observation.sectionHeaders,
      fieldLabels,
      buttons,
      attachmentsPresent,
      textareasPresent,
      statusAreasPresent,
      layoutPatterns: observation.layoutPatterns,
    });
  }

  async extractQaReport(
    options: VisitNoteExtractorOptions = {},
  ): Promise<VisitNoteQaReport> {
    const snapshot = await extractVisitNoteSnapshot(this.page, options);
    return buildVisitNoteQaReport(snapshot);
  }

  async extractDocumentReport(
    options: VisitNoteExtractorOptions = {},
  ) {
    return extractDocument(this.page, options);
  }

  private async getSectionHeaders(): Promise<string[]> {
    const values = await collectVisibleTextsFromSelectors(
      this.page,
      VISIT_NOTE_DETAIL_SELECTORS.sectionHeaderSelectors,
      24,
    );

    return values
      .map((value) => sanitizeStructuralLabel(value))
      .filter((value): value is string => Boolean(value));
  }

  private async getFieldLabels(): Promise<string[]> {
    const values = await collectVisibleTextsFromSelectors(
      this.page,
      VISIT_NOTE_DETAIL_SELECTORS.fieldLabelSelectors,
      40,
    );

    return values
      .map((value) => sanitizeStructuralLabel(value))
      .filter((value): value is string => Boolean(value));
  }

  private async getButtons(): Promise<PortalButtonSummary[]> {
    const values = await collectVisibleTextsFromSelectors(
      this.page,
      VISIT_NOTE_DETAIL_SELECTORS.buttonSelectors,
      24,
    );

    const summaries = values
      .map((value) => buildButtonSummary(value))
      .filter((value): value is PortalButtonSummary => Boolean(value));

    const seen = new Set<string>();
    const unique: PortalButtonSummary[] = [];

    for (const summary of summaries) {
      const key = `${summary.label}:${summary.classification}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      unique.push(summary);
    }

    return unique;
  }

  private async hasAttachments(): Promise<boolean> {
    return hasVisibleLocator(this.page, VISIT_NOTE_DETAIL_SELECTORS.attachmentSelectors, 1_000);
  }

  private async hasTextAreas(): Promise<boolean> {
    return hasVisibleLocator(this.page, VISIT_NOTE_DETAIL_SELECTORS.textAreaSelectors, 1_000);
  }

  private async hasStatusAreas(): Promise<boolean> {
    return hasVisibleLocator(this.page, VISIT_NOTE_DETAIL_SELECTORS.statusAreaSelectors, 1_000);
  }
}

function classifyDetailPageType(input: {
  url: string | null;
  title: string | null;
  sectionHeaders: string[];
  fieldLabels: string[];
  textareasPresent: boolean;
  hasVisitIndicators: boolean;
  hasOrderIndicators: boolean;
}): QaQueueItemDetailSurface["pageType"] {
  if (input.url && VISIT_NOTE_DETAIL_SELECTORS.detailUrlPattern.test(input.url)) {
    return "visit_note_detail";
  }

  if (input.url && /\/documents\/(?:assessment|oasis)\//i.test(input.url)) {
    return "oasis_detail";
  }

  if (input.url && /\/documents\/(?:planofcare|plan-of-care|poc)\//i.test(input.url)) {
    return "plan_of_care_detail";
  }

  if (input.url && /\/documents\/(?:order|orders)\/(?:admission|admit)\b/i.test(input.url)) {
    return "admission_order_detail";
  }

  if (input.url && /\/documents\/(?:order|orders)\//i.test(input.url)) {
    return "physician_order_detail";
  }

  if (input.url && VISIT_NOTE_DETAIL_SELECTORS.orderDetailUrlPattern.test(input.url)) {
    return "order_detail";
  }

  const combinedText = [
    normalizeText(input.title),
    ...input.sectionHeaders,
    ...input.fieldLabels,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  if (input.hasVisitIndicators) {
    return "visit_note_detail";
  }

  if (input.hasOrderIndicators) {
    return "order_detail";
  }

  if (/oasis|clinical assessment|functional status/i.test(combinedText)) {
    return "oasis_detail";
  }

  if (/plan of care|certification period|homebound|interventions/i.test(combinedText)) {
    return "plan_of_care_detail";
  }

  if (/admission order|admit/i.test(combinedText)) {
    return "admission_order_detail";
  }

  if (/physician order|allowed practitioner|order type/i.test(combinedText)) {
    return "physician_order_detail";
  }

  if (/visit note/i.test(combinedText)) {
    return "visit_note_detail";
  }

  if (/physician or allowed practitioner|order type|medication/i.test(combinedText)) {
    return "order_detail";
  }

  if (/note/i.test(combinedText) || input.textareasPresent) {
    return "note_detail";
  }

  if (/document/i.test(combinedText)) {
    return "document_detail";
  }

  return "unknown";
}
