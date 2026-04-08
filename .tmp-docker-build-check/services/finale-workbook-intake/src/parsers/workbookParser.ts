import * as XLSX from "xlsx";
import {
  rawDcRowSchema,
  rawDizRowSchema,
  rawSocPocRowSchema,
  rawVisitNotesRowSchema,
} from "../validators/rawRowSchemas";
import type {
  ParsedWorkbookData,
  RawDcRow,
  RawDizRow,
  RawSocPocRow,
  RawVisitNotesRow,
  WorkbookSourceType,
} from "../types/patientEpisodeWorkItem";

type CellValue = string | number | boolean | null | undefined;
type HeaderAliases = Record<string, string[]>;
type ExtractedRow = {
  sourceSheet: string;
  sourceRowNumber: number;
  values: Record<string, string | null>;
};
type SheetDiagnostic = ParsedWorkbookData["diagnostics"]["sheetSummaries"][number];

interface SheetExtractionConfig {
  sourceType: WorkbookSourceType;
  preferredSheetNames: string[];
  headerAliases: HeaderAliases;
  minimumHeaderMatches: number;
  shouldExcludeRow?: (values: Record<string, string | null>) => string | null;
}

const TARGET_SHEETS = {
  socPoc: "OASIS SOC-ROC-REC & POC",
  dc: "OASIS DC-TXR-DEATH",
  visitNotes: "VISIT NOTES",
  diz: "DIZ",
  trackingReport: "OASIS Tracking Report",
} as const;

const socPocConfig: SheetExtractionConfig = {
  sourceType: "socPoc",
  preferredSheetNames: [TARGET_SHEETS.socPoc],
  minimumHeaderMatches: 5,
  headerAliases: {
    patientName: ["PATIENT NAME", "PATIENT"],
    episodeDate: ["EPISODE DATE", "EPISODE"],
    assignedStaff: ["ASSIGNED STAFF", "ASSIGNED", "ASSIGNED TO"],
    payer: ["PAYER", "INSURANCE"],
    rfa: ["RFA"],
    trackingDays: ["30 DAYS TRACKING", "30 DAY TRACKING", "30DAYS TRACKING"],
    daysInPeriod: [
      "TOTAL NUMBER OF DAYS IN THE 30-DAY PERIOD",
      "TOTAL DAYS IN THE 30-DAY PERIOD",
      "DAYS IN 30-DAY PERIOD",
      "DAYS IN PERIOD",
    ],
    daysLeft: [
      "VERIFY THE NUMBER OF DAYS LEFT BEFORE OASIS DUE DATE FOR ACCURACY",
      "DAYS LEFT BEFORE OASIS DUE DATE",
      "OASIS DAYS LEFT",
      "DAYS LEFT",
    ],
    coding: ["CODING"],
    oasisQaRemarks: ["OASIS QA REMARKS", "OASIS QA"],
    pocQaRemarks: ["POC QA REMARKS", "POC QA"],
  },
};

const dcConfig: SheetExtractionConfig = {
  sourceType: "dc",
  preferredSheetNames: [TARGET_SHEETS.dc],
  minimumHeaderMatches: 5,
  headerAliases: {
    patientName: ["PATIENT NAME", "PATIENT"],
    episodeDate: ["EPISODE DATE", "EPISODE"],
    assignedStaff: ["ASSIGNED STAFF", "ASSIGNED", "ASSIGNED TO"],
    payer: ["PAYER", "INSURANCE"],
    rfa: ["RFA"],
    trackingDays: ["30 DAYS TRACKING", "30 DAY TRACKING", "30DAYS TRACKING"],
    daysInPeriod: [
      "TOTAL NUMBER OF DAYS IN THE 30-DAY PERIOD",
      "TOTAL DAYS IN THE 30-DAY PERIOD",
      "DAYS IN 30-DAY PERIOD",
      "DAYS IN PERIOD",
    ],
    daysLeft: [
      "VERIFY THE NUMBER OF DAYS LEFT BEFORE OASIS DUE DATE FOR ACCURACY",
      "DAYS LEFT BEFORE OASIS DUE DATE",
      "OASIS DAYS LEFT",
      "DAYS LEFT",
    ],
    oasisQaRemarks: ["OASIS QA REMARKS", "OASIS QA"],
    dcSummary: ["DC SUMMARY", "SUMMARY"],
  },
};

const visitNotesConfig: SheetExtractionConfig = {
  sourceType: "visitNotes",
  preferredSheetNames: [TARGET_SHEETS.visitNotes],
  minimumHeaderMatches: 6,
  headerAliases: {
    patientName: ["PATIENT NAME", "PATIENT"],
    medicareNumber: ["MEDICARE NO", "MEDICARE NUMBER", "MEDICARE #"],
    payer: ["PAYER", "INSURANCE"],
    socDate: ["SOC DATE"],
    episodePeriod: ["EPISODE PERIOD"],
    billingPeriod: ["BILLING PERIOD"],
    status: ["STATUS"],
    oasisQa: ["OASIS QA"],
    oasisStatus: ["OASIS STATUS"],
    qa: ["QA"],
    sn: ["SN"],
    ptOtSt: ["PT OT ST", "PT/OT/ST"],
    hhaMsw: ["HHA MSW", "HHA/MSW"],
    billingStatus: ["BILLING STATUS"],
  },
};

const dizConfig: SheetExtractionConfig = {
  sourceType: "diz",
  preferredSheetNames: [TARGET_SHEETS.diz],
  minimumHeaderMatches: 5,
  headerAliases: {
    patientName: ["PATIENT NAME", "PATIENT"],
    episodeDateOrBillingPeriod: [
      "EPISODE DATE BILLING PERIOD",
      "EPISODE DATE / BILLING PERIOD",
      "BILLING PERIOD",
      "EPISODE DATE",
    ],
    clinician: ["CLINICIAN"],
    qaSpecialist: ["QA SPECIALIST", "QA"],
    sn: ["SN"],
    rehab: ["REHAB"],
    hhaAndMsw: ["HHA AND MSW", "HHA & MSW"],
    poAndOrder: ["PO AND ORDER", "PO & ORDER", "PO ORDER"],
    status: ["STATUS"],
  },
};

const trackingReportConfig: SheetExtractionConfig = {
  sourceType: "trackingReport",
  preferredSheetNames: [TARGET_SHEETS.trackingReport],
  minimumHeaderMatches: 6,
  headerAliases: {
    patientName: ["PATIENT NAME (MR#)", "PATIENT NAME", "PATIENT"],
    episodeDate: ["SOC DATE"],
    assignedStaff: ["ASSIGNED STAFF"],
    payer: ["PAYER"],
    rfa: ["RFA"],
    trackingDays: ["30 DAYS TRACKING", "30 DAY TRACKING", "30DAYS TRACKING"],
    coding: ["STATUS"],
    oasisQaRemarks: ["COMPLETED DATE"],
    pocQaRemarks: [],
  },
  shouldExcludeRow: (values) => {
    const patientName = values.patientName?.trim() ?? "";
    const rfa = values.rfa?.trim() ?? "";

    if (/^Document:/i.test(patientName)) {
      return "Tracking report document marker row.";
    }

    if (/^Printed on\b/i.test(patientName) || /^Powered by:/i.test(rfa)) {
      return "Tracking report footer row.";
    }

    return null;
  },
};

function normalizeHeaderToken(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeCellValue(value: CellValue): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  const stringValue = String(value).trim();
  return stringValue.length > 0 ? stringValue : null;
}

function isBlankRow(row: CellValue[]): boolean {
  return row.every((value) => normalizeCellValue(value) === null);
}

function createMissingSheetDiagnostic(sheetName: string): SheetDiagnostic {
  return {
    sheetName,
    detectedSourceType: null,
    rowCount: 0,
    headerRowNumber: null,
    headerMatchCount: 0,
    detectedHeaders: {},
    extractedRowCount: 0,
    excludedRows: [],
  };
}

function buildUnparsedSheetDiagnostic(
  workbook: XLSX.WorkBook,
  sheetName: string,
): SheetDiagnostic {
  const worksheet = workbook.Sheets[sheetName];
  const rows = worksheet
    ? XLSX.utils.sheet_to_json<CellValue[]>(worksheet, {
        header: 1,
        raw: false,
        defval: null,
        blankrows: true,
      })
    : [];

  return {
    sheetName,
    detectedSourceType: null,
    rowCount: rows.length,
    headerRowNumber: null,
    headerMatchCount: 0,
    detectedHeaders: {},
    extractedRowCount: 0,
    excludedRows: [],
  };
}

function resolveHeaderMatch(
  row: CellValue[],
  config: SheetExtractionConfig,
): {
  headerMatchCount: number;
  headerMap: Record<string, number>;
  detectedHeaders: Record<string, string>;
} {
  const headerMap: Record<string, number> = {};
  const detectedHeaders: Record<string, string> = {};

  row.forEach((cellValue, index) => {
    const normalizedCell = normalizeHeaderToken(normalizeCellValue(cellValue) ?? "");
    if (!normalizedCell) {
      return;
    }

    for (const [field, aliases] of Object.entries(config.headerAliases)) {
      if (headerMap[field] !== undefined) {
        continue;
      }

      const matches = aliases.some((alias) => normalizeHeaderToken(alias) === normalizedCell);
      if (matches) {
        headerMap[field] = index;
        detectedHeaders[field] = normalizeCellValue(cellValue) ?? "";
      }
    }
  });

  return {
    headerMatchCount: Object.keys(headerMap).length,
    headerMap,
    detectedHeaders,
  };
}

function findBestHeaderMatch(
  rows: CellValue[][],
  config: SheetExtractionConfig,
): {
  headerMatchCount: number;
  headerRowNumber: number | null;
  headerMap: Record<string, number>;
  detectedHeaders: Record<string, string>;
} {
  let bestMatchCount = 0;
  let bestHeaderRowNumber: number | null = null;
  let bestHeaderMap: Record<string, number> = {};
  let bestDetectedHeaders: Record<string, string> = {};

  rows.forEach((row, rowIndex) => {
    if (isBlankRow(row)) {
      return;
    }

    const match = resolveHeaderMatch(row, config);
    if (match.headerMatchCount < bestMatchCount) {
      return;
    }

    if (
      match.headerMatchCount === bestMatchCount &&
      bestHeaderRowNumber !== null &&
      rowIndex + 1 >= bestHeaderRowNumber
    ) {
      return;
    }

    bestMatchCount = match.headerMatchCount;
    bestHeaderRowNumber = rowIndex + 1;
    bestHeaderMap = match.headerMap;
    bestDetectedHeaders = match.detectedHeaders;
  });

  return {
    headerMatchCount: bestMatchCount,
    headerRowNumber: bestHeaderRowNumber,
    headerMap: bestHeaderMap,
    detectedHeaders: bestDetectedHeaders,
  };
}

function extractRowsFromSheet(
  worksheet: XLSX.WorkSheet,
  sheetName: string,
  config: SheetExtractionConfig,
): {
  rows: ExtractedRow[];
  diagnostic: SheetDiagnostic;
} {
  const rows = XLSX.utils.sheet_to_json<CellValue[]>(worksheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: true,
  });

  const extractedRows: ExtractedRow[] = [];
  const excludedRows: SheetDiagnostic["excludedRows"] = [];
  let currentHeaderMap: Record<string, number> | null = null;
  let detectedHeaders: Record<string, string> = {};
  let headerRowNumber: number | null = null;

  rows.forEach((row, rowIndex) => {
    if (isBlankRow(row)) {
      return;
    }

    const headerResolution = resolveHeaderMatch(row, config);
    if (headerResolution.headerMatchCount >= config.minimumHeaderMatches) {
      currentHeaderMap = headerResolution.headerMap;
      detectedHeaders = headerResolution.detectedHeaders;
      headerRowNumber = rowIndex + 1;
      return;
    }

    if (!currentHeaderMap) {
      return;
    }

    const values = Object.fromEntries(
      Object.keys(config.headerAliases).map((field) => {
        const columnIndex = currentHeaderMap?.[field];
        const rawValue = columnIndex === undefined ? null : row[columnIndex];
        return [field, normalizeCellValue(rawValue)];
      }),
    );

    if (!Object.values(values).some((value) => value !== null)) {
      return;
    }

    const exclusionReason = config.shouldExcludeRow?.(values) ?? null;
    if (exclusionReason) {
      excludedRows.push({
        sourceRowNumber: rowIndex + 1,
        reason: exclusionReason,
        sample:
          Object.values(values)
            .filter((value): value is string => Boolean(value))
            .slice(0, 3)
            .join(" | ") || null,
      });
      return;
    }

    extractedRows.push({
      sourceSheet: sheetName,
      sourceRowNumber: rowIndex + 1,
      values,
    });
  });

  return {
    rows: extractedRows,
    diagnostic: {
      sheetName,
      detectedSourceType: config.sourceType,
      rowCount: rows.length,
      headerRowNumber,
      headerMatchCount: Object.keys(detectedHeaders).length,
      detectedHeaders,
      extractedRowCount: extractedRows.length,
      excludedRows,
    },
  };
}

function findSheetCandidates(
  workbook: XLSX.WorkBook,
  config: SheetExtractionConfig,
): Array<{
  sheetName: string;
  worksheet: XLSX.WorkSheet | null;
  preferredName: boolean;
  headerRowNumber: number | null;
  headerMatchCount: number;
}> {
  return workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = worksheet
      ? XLSX.utils.sheet_to_json<CellValue[]>(worksheet, {
          header: 1,
          raw: false,
          defval: null,
          blankrows: true,
        })
      : [];
    const bestHeaderMatch = findBestHeaderMatch(rows, config);
    const preferredName = config.preferredSheetNames.includes(sheetName);

    return {
      sheetName,
      worksheet: worksheet ?? null,
      preferredName,
      headerRowNumber: bestHeaderMatch.headerRowNumber,
      headerMatchCount: bestHeaderMatch.headerMatchCount,
    };
  })
    .filter((candidate) => candidate.headerMatchCount >= config.minimumHeaderMatches)
    .sort((left, right) => {
      if (left.headerMatchCount !== right.headerMatchCount) {
        return right.headerMatchCount - left.headerMatchCount;
      }
      if (left.preferredName !== right.preferredName) {
        return left.preferredName ? -1 : 1;
      }
      if ((left.headerRowNumber ?? Number.MAX_SAFE_INTEGER) !== (right.headerRowNumber ?? Number.MAX_SAFE_INTEGER)) {
        return (left.headerRowNumber ?? Number.MAX_SAFE_INTEGER) - (right.headerRowNumber ?? Number.MAX_SAFE_INTEGER);
      }
      return left.sheetName.localeCompare(right.sheetName);
    });
}

function detectSheetForConfig(
  workbook: XLSX.WorkBook,
  config: SheetExtractionConfig,
  reservedSheetNames: Set<string>,
): {
  detectedSheetName: string | null;
  headerRowNumber: number | null;
  headerMatchCount: number;
  minimumHeaderMatches: number;
  worksheet: XLSX.WorkSheet | null;
} {
  const candidates = findSheetCandidates(workbook, config);
  const detected = candidates.find((candidate) => !reservedSheetNames.has(candidate.sheetName)) ?? null;

  return {
    detectedSheetName: detected?.sheetName ?? null,
    headerRowNumber: detected?.headerRowNumber ?? null,
    headerMatchCount: detected?.headerMatchCount ?? 0,
    minimumHeaderMatches: config.minimumHeaderMatches,
    worksheet: detected?.worksheet ?? null,
  };
}

function parseSheet<T extends RawSocPocRow | RawDcRow | RawVisitNotesRow | RawDizRow>(
  workbook: XLSX.WorkBook,
  config: SheetExtractionConfig,
  mapper: (row: ExtractedRow) => T,
  reservedSheetNames: Set<string>,
): {
  detection: ParsedWorkbookData["diagnostics"]["sourceDetections"][number];
  rows: T[];
  diagnostic: SheetDiagnostic | null;
} {
  const detection = detectSheetForConfig(workbook, config, reservedSheetNames);
  if (!detection.worksheet || !detection.detectedSheetName) {
    return {
      detection: {
        sourceType: config.sourceType,
        detectedSheetName: null,
        detectionStatus: "missing",
        headerRowNumber: null,
        headerMatchCount: detection.headerMatchCount,
        minimumHeaderMatches: detection.minimumHeaderMatches,
        extractedRowCount: 0,
      },
      rows: [],
      diagnostic: null,
    };
  }

  const extracted = extractRowsFromSheet(detection.worksheet, detection.detectedSheetName, config);
  reservedSheetNames.add(detection.detectedSheetName);
  return {
    detection: {
      sourceType: config.sourceType,
      detectedSheetName: detection.detectedSheetName,
      detectionStatus: "detected",
      headerRowNumber: detection.headerRowNumber,
      headerMatchCount: detection.headerMatchCount,
      minimumHeaderMatches: detection.minimumHeaderMatches,
      extractedRowCount: extracted.rows.length,
    },
    rows: extracted.rows.map(mapper),
    diagnostic: extracted.diagnostic,
  };
}

export function parseWorkbook(workbookPath: string): ParsedWorkbookData {
  const workbook = XLSX.readFile(workbookPath, {
    cellDates: false,
  });
  const reservedSheetNames = new Set<string>();

  const trackingReport = parseSheet(workbook, trackingReportConfig, (row) =>
    rawSocPocRowSchema.parse({
      sourceSheet: row.sourceSheet,
      sourceRowNumber: row.sourceRowNumber,
      patientName: row.values.patientName?.replace(/\s*\([^)]*\)\s*$/, "") ?? null,
      episodeDate: row.values.episodeDate,
      assignedStaff: row.values.assignedStaff,
      payer: row.values.payer,
      rfa: row.values.rfa,
      trackingDays: row.values.trackingDays,
      daysInPeriod: null,
      daysLeft: null,
      coding: row.values.coding,
      oasisQaRemarks: row.values.oasisQaRemarks,
      pocQaRemarks: null,
    }),
    reservedSheetNames,
  );
  const socPocLegacy = parseSheet(workbook, socPocConfig, (row) =>
    rawSocPocRowSchema.parse({
      sourceSheet: row.sourceSheet,
      sourceRowNumber: row.sourceRowNumber,
      patientName: row.values.patientName,
      episodeDate: row.values.episodeDate,
      assignedStaff: row.values.assignedStaff,
      payer: row.values.payer,
      rfa: row.values.rfa,
      trackingDays: row.values.trackingDays,
      daysInPeriod: row.values.daysInPeriod,
      daysLeft: row.values.daysLeft,
      coding: row.values.coding,
      oasisQaRemarks: row.values.oasisQaRemarks,
      pocQaRemarks: row.values.pocQaRemarks,
    }),
    reservedSheetNames,
  );
  const dc = parseSheet(workbook, dcConfig, (row) =>
    rawDcRowSchema.parse({
      sourceSheet: row.sourceSheet,
      sourceRowNumber: row.sourceRowNumber,
      patientName: row.values.patientName,
      episodeDate: row.values.episodeDate,
      assignedStaff: row.values.assignedStaff,
      payer: row.values.payer,
      rfa: row.values.rfa,
      trackingDays: row.values.trackingDays,
      daysInPeriod: row.values.daysInPeriod,
      daysLeft: row.values.daysLeft,
      oasisQaRemarks: row.values.oasisQaRemarks,
      dcSummary: row.values.dcSummary,
    }),
    reservedSheetNames,
  );
  const visitNotes = parseSheet(workbook, visitNotesConfig, (row) =>
    rawVisitNotesRowSchema.parse({
      sourceSheet: row.sourceSheet,
      sourceRowNumber: row.sourceRowNumber,
      patientName: row.values.patientName,
      medicareNumber: row.values.medicareNumber,
      payer: row.values.payer,
      socDate: row.values.socDate,
      episodePeriod: row.values.episodePeriod,
      billingPeriod: row.values.billingPeriod,
      status: row.values.status,
      oasisQa: row.values.oasisQa,
      oasisStatus: row.values.oasisStatus,
      qa: row.values.qa,
      sn: row.values.sn,
      ptOtSt: row.values.ptOtSt,
      hhaMsw: row.values.hhaMsw,
      billingStatus: row.values.billingStatus,
    }),
    reservedSheetNames,
  );
  const diz = parseSheet(workbook, dizConfig, (row) =>
    rawDizRowSchema.parse({
      sourceSheet: row.sourceSheet,
      sourceRowNumber: row.sourceRowNumber,
      patientName: row.values.patientName,
      episodeDateOrBillingPeriod: row.values.episodeDateOrBillingPeriod,
      clinician: row.values.clinician,
      qaSpecialist: row.values.qaSpecialist,
      sn: row.values.sn,
      rehab: row.values.rehab,
      hhaAndMsw: row.values.hhaAndMsw,
      poAndOrder: row.values.poAndOrder,
      status: row.values.status,
    }),
    reservedSheetNames,
  );

  const sourceDetections = [
    socPocLegacy.detection,
    dc.detection,
    visitNotes.detection,
    diz.detection,
    trackingReport.detection,
  ];
  const warnings: string[] = [];
  const hasTrackingReport = trackingReport.detection.detectionStatus === "detected";
  if (!hasTrackingReport) {
    for (const requiredDetection of [socPocLegacy.detection, dc.detection, visitNotes.detection, diz.detection]) {
      if (requiredDetection.detectionStatus === "missing") {
        warnings.push(`Missing expected worksheet content for ${requiredDetection.sourceType}.`);
      }
    }
  }

  const configuredDiagnostics = new Map<string, SheetDiagnostic>(
    [socPocLegacy.diagnostic, dc.diagnostic, visitNotes.diagnostic, diz.diagnostic, trackingReport.diagnostic]
      .filter((diagnostic): diagnostic is SheetDiagnostic => diagnostic !== null)
      .map((diagnostic) => [diagnostic.sheetName, diagnostic]),
  );
  const sheetSummaries: SheetDiagnostic[] = workbook.SheetNames.map((sheetName) =>
    configuredDiagnostics.get(sheetName) ?? buildUnparsedSheetDiagnostic(workbook, sheetName),
  );

  return {
    workbookPath,
    sheetNames: workbook.SheetNames,
    socPocRows: [...socPocLegacy.rows, ...trackingReport.rows],
    dcRows: dc.rows,
    visitNotesRows: visitNotes.rows,
    dizRows: diz.rows,
    warnings,
    diagnostics: {
      sourceDetections,
      sheetSummaries,
    },
  };
}
