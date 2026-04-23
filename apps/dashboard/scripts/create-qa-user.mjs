#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";

const DEFAULT_AGENCY_IDS = [
  "aplus-home-health",
  "active-home-health",
  "avery-home-health",
  "meadows-home-health",
  "star-home-health",
];

function printUsage() {
  console.log(`Usage:
  pnpm dashboard:qa-user -- --email qa@example.com --name "QA User" [--password "temporary-password"] [--agencies active-home-health,star-home-health]

Options:
  --email      Required. QA user's dashboard login email.
  --name       Optional. Display name. Defaults to the email local part.
  --password   Optional. Temporary password to hash. If omitted, a password is generated and printed once.
  --agencies   Optional. Comma-separated agency ids. Defaults to all current agencies.
`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }

    args[key] = next;
    index += 1;
  }
  return args;
}

function hashPassword(password) {
  return `sha256:${createHash("sha256").update(password, "utf8").digest("hex")}`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printUsage();
  process.exit(0);
}

const email = String(args.email ?? "").trim().toLowerCase();
if (!isValidEmail(email)) {
  console.error("Missing or invalid --email.");
  printUsage();
  process.exit(1);
}

const generatedPassword = !args.password;
const password = generatedPassword
  ? randomBytes(18).toString("base64url")
  : String(args.password);

if (password.length < 12) {
  console.error("Dashboard QA passwords must be at least 12 characters.");
  process.exit(1);
}

const name = String(args.name ?? email.split("@")[0] ?? email).trim();
const allowedAgencyIds = String(args.agencies ?? "")
  .split(",")
  .map((agencyId) => agencyId.trim())
  .filter(Boolean);

const user = {
  email,
  name,
  passwordHash: hashPassword(password),
  allowedAgencyIds: allowedAgencyIds.length > 0 ? allowedAgencyIds : DEFAULT_AGENCY_IDS,
};

console.log("Dashboard QA user:");
console.log(JSON.stringify(user, null, 2));
console.log("");
console.log("DASHBOARD_QA_USERS_JSON value for one user:");
console.log(JSON.stringify([user]));

if (generatedPassword) {
  console.log("");
  console.log("Generated temporary password. Share it with the user through a secure channel:");
  console.log(password);
}
