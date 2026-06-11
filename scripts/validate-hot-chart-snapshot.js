const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");

const SNAPSHOT_PATH = "curated-chart-snapshot.json";
const MIN_DYNAMIC_CANDIDATES = 80;
const OLD_STATIC_HASH = "c120e092a58916c675965abff701c6914227218d0fa132d808399a56cd1a96fc";

function fail(message) {
  throw new Error(message);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const raw = readFileSync(SNAPSHOT_PATH);
const snapshot = JSON.parse(raw.toString("utf8"));
const hash = createHash("sha256").update(raw).digest("hex");

if (hash === OLD_STATIC_HASH) {
  fail("Snapshot hash still matches the old static 24-track payload.");
}

if (snapshot.provider !== "remote-json") {
  fail("provider must be remote-json.");
}

if (snapshot.sourceType !== "live-online-dynamic") {
  fail("sourceType must be live-online-dynamic.");
}

if (snapshot.source !== "curated-chart-snapshot" && snapshot.sourceName !== "curated-chart-snapshot") {
  fail("source/sourceName must identify curated-chart-snapshot.");
}

if (typeof snapshot.generatedAt !== "string" || !Number.isFinite(Date.parse(snapshot.generatedAt))) {
  fail("generatedAt must be a valid ISO timestamp.");
}

if (typeof snapshot.batchId !== "string" || !snapshot.batchId.trim()) {
  fail("batchId must be present.");
}

if (!Array.isArray(snapshot.candidates) || snapshot.candidates.length < MIN_DYNAMIC_CANDIDATES) {
  fail(`candidates must contain at least ${MIN_DYNAMIC_CANDIDATES} entries.`);
}

const seen = new Set();

snapshot.candidates.forEach((candidate, index) => {
  if (!candidate || typeof candidate !== "object") {
    fail(`Candidate ${index + 1} must be an object.`);
  }

  if (candidate.rank !== index + 1) {
    fail(`Candidate ${index + 1} rank must match list position.`);
  }

  for (const field of ["title", "artist", "category", "region", "source"]) {
    if (typeof candidate[field] !== "string" || !candidate[field].trim()) {
      fail(`Candidate ${index + 1} missing ${field}.`);
    }
  }

  if (!isStringArray(candidate.styles) || !candidate.styles.length) {
    fail(`Candidate ${index + 1} must include styles.`);
  }

  const key = `${candidate.artist} - ${candidate.title}`.toLowerCase();

  if (seen.has(key)) {
    fail(`Duplicate candidate: ${key}`);
  }

  seen.add(key);
});

console.log(
  `Snapshot validation passed: ${snapshot.candidates.length} candidates, generatedAt ${snapshot.generatedAt}, batchId ${snapshot.batchId}, sha256 ${hash}.`,
);
