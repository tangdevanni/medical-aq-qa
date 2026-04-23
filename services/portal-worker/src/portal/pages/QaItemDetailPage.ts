import {
  qaItemDetailSummarySchema,
  type OpenBehavior,
  type QaItemDetailSummary,
} from "@medical-ai-qa/shared-types";
import { type Page } from "@playwright/test";
import { QA_BOARD_SELECTORS } from "../selectors/qa-board.selectors";
import { QA_ITEM_DETAIL_SELECTORS } from "../selectors/qa-item-detail.selectors";
import {
  collectVisibleTextsFromSelectors,
  hasVisibleLocator,
  normalizeText,
  readFirstVisibleText,
} from "../utils/page-helpers";

export interface QaItemDetailPageContext {
  openBehavior: OpenBehavior;
  routeChanged: boolean;
  modalDetected: boolean;
  newTabDetected: boolean;
}

export class QaItemDetailPage {
  constructor(
    private readonly page: Page,
    private readonly detailContext: QaItemDetailPageContext,
  ) {}

  async isLoaded(): Promise<boolean> {
    const [titleText, hasDetailMarkers, hasSections, hasActions, hasTextAreas] =
      await Promise.all([
        this.getHeaderTitleText(),
        hasVisibleLocator(this.page, QA_ITEM_DETAIL_SELECTORS.detailMarkers, 2_500),
        this.getVisibleSectionNames(),
        this.getVisibleActionLabels(),
        this.hasTextAreas(),
      ]);

    return Boolean(titleText || hasDetailMarkers || hasSections.length > 0 || hasActions.length > 0 || hasTextAreas);
  }

  async getHeaderTitleText(): Promise<string | null> {
    const text = await readFirstVisibleText(this.page, QA_ITEM_DETAIL_SELECTORS.headerSelectors, 2_500);
    return text && text.length <= 120 ? text : null;
  }

  async getStatusText(): Promise<string | null> {
    const statuses = await collectVisibleTextsFromSelectors(
      this.page,
      QA_ITEM_DETAIL_SELECTORS.statusSelectors,
      10,
    );

    return (
      statuses.find((status) =>
        QA_BOARD_SELECTORS.statusTexts.some((candidate) =>
          status.toLowerCase().includes(candidate.toLowerCase()),
        ),
      ) ?? statuses[0] ?? null
    );
  }

  async getVisibleSectionNames(): Promise<string[]> {
    const sectionNames = await collectVisibleTextsFromSelectors(
      this.page,
      QA_ITEM_DETAIL_SELECTORS.sectionHeadingSelectors,
      20,
    );

    return sectionNames.filter((name) => name.length >= 2 && name.length <= 60);
  }

  async getVisibleActionLabels(): Promise<string[]> {
    const actionLabels = await collectVisibleTextsFromSelectors(
      this.page,
      QA_ITEM_DETAIL_SELECTORS.actionLabelSelectors,
      20,
    );

    return actionLabels.filter((label) => label.length >= 2 && label.length <= 40);
  }

  async hasRelatedDocumentsPanel(): Promise<boolean> {
    return hasVisibleLocator(this.page, QA_ITEM_DETAIL_SELECTORS.relatedDocumentsSelectors, 1_500);
  }

  async hasTextAreas(): Promise<boolean> {
    return hasVisibleLocator(this.page, QA_ITEM_DETAIL_SELECTORS.textAreaSelectors, 1_500);
  }

  async hasAttachmentArea(): Promise<boolean> {
    return hasVisibleLocator(this.page, QA_ITEM_DETAIL_SELECTORS.attachmentAreaSelectors, 1_500);
  }

  async getMinimalSummary(): Promise<QaItemDetailSummary> {
    const [
      detailViewDetected,
      titleText,
      statusText,
      sectionNames,
      actionLabels,
      hasRelatedDocumentsPanel,
      hasAttachmentArea,
      hasTextAreas,
    ] = await Promise.all([
      this.isLoaded(),
      this.getHeaderTitleText(),
      this.getStatusText(),
      this.getVisibleSectionNames(),
      this.getVisibleActionLabels(),
      this.hasRelatedDocumentsPanel(),
      this.hasAttachmentArea(),
      this.hasTextAreas(),
    ]);

    return qaItemDetailSummarySchema.parse({
      openBehavior: this.detailContext.openBehavior,
      titleText: normalizeText(titleText),
      statusText: normalizeText(statusText),
      sectionNames,
      actionLabels,
      hasRelatedDocumentsPanel,
      hasAttachmentArea,
      hasTextAreas,
      detailViewDetected,
      routeChanged: this.detailContext.routeChanged,
      modalDetected: this.detailContext.modalDetected,
      newTabDetected: this.detailContext.newTabDetected,
    });
  }
}
