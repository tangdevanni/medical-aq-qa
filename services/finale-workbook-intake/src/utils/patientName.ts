function toTitleCase(token: string): string {
  return token
    .toLowerCase()
    .replace(/(^|[ '\-])([a-z])/g, (_, boundary: string, char: string) => `${boundary}${char.toUpperCase()}`);
}

function tokenizeName(rawName: string): string[] {
  return rawName
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\./g, "")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function parsePatientName(rawName: string): string[] {
  const trimmed = rawName.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.includes(",")) {
    const [lastNamePart, remainder] = trimmed.split(",", 2);
    const lastNameTokens = tokenizeName(lastNamePart);
    const remainderTokens = tokenizeName(remainder ?? "");
    return [...remainderTokens, ...lastNameTokens];
  }

  return tokenizeName(trimmed);
}

export function normalizePatientName(rawName: string | null | undefined): string {
  if (!rawName) {
    return "UNKNOWN PATIENT";
  }

  const tokens = parsePatientName(rawName).map((token) =>
    token.replace(/[^A-Za-z0-9'\-]/g, "").toUpperCase(),
  );

  return tokens.filter(Boolean).join(" ") || "UNKNOWN PATIENT";
}

export function formatPatientName(rawName: string | null | undefined): string {
  if (!rawName) {
    return "Unknown Patient";
  }

  const tokens = parsePatientName(rawName).map((token) =>
    token.replace(/[^A-Za-z0-9'\-]/g, ""),
  );

  const formatted = tokens.filter(Boolean).map((token) => toTitleCase(token)).join(" ");
  return formatted || "Unknown Patient";
}

export function createPatientIdentityKey(rawName: string | null | undefined): string {
  return normalizePatientName(rawName).replace(/[^A-Z0-9]/g, "");
}
