const { existsSync, readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "..");
const MIN_CANDIDATES = 80;
const INDEX_PATH = join(ROOT, "index.json");
const LEGACY_SNAPSHOT_PATH = join(ROOT, "curated-chart-snapshot.json");

const GENRES = [
  "electronic",
  "rnb",
  "jazz",
  "folk",
  "indie",
  "rock",
  "pop",
  "global-new-releases",
  "mandopop-new-releases",
  "mandopop",
  "j-pop",
  "k-pop",
  "classical",
  "latin",
  "hip-hop",
];

const FACT_ARRAY_FIELDS = [
  "artistFacts",
  "trackFacts",
  "albumFacts",
  "chartFacts",
  "awardFacts",
  "releaseContext",
  "sourceNotes",
  "promoFacts",
];

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  if (!existsSync(path)) {
    fail(`Missing file: ${path}`);
  }

  return JSON.parse(readFileSync(path, "utf8"));
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateCandidate(candidate, index, genre, seen) {
  if (!isRecord(candidate)) {
    fail(`${genre} candidate ${index + 1} must be an object.`);
  }

  if (candidate.rank !== index + 1) {
    fail(`${genre} candidate ${index + 1} rank must be ${index + 1}.`);
  }

  for (const field of ["title", "artist", "category", "region", "source"]) {
    if (typeof candidate[field] !== "string" || !candidate[field].trim()) {
      fail(`${genre} candidate ${index + 1} missing ${field}.`);
    }
  }

  if (!isStringArray(candidate.styles) || !candidate.styles.length) {
    fail(`${genre} candidate ${index + 1} must include styles.`);
  }

  for (const field of FACT_ARRAY_FIELDS) {
    if (candidate[field] !== undefined && !isStringArray(candidate[field])) {
      fail(`${genre} candidate ${index + 1} ${field} must be a string array.`);
    }
  }

  if (candidate.aliases !== undefined) {
    if (!Array.isArray(candidate.aliases)) {
      fail(`${genre} candidate ${index + 1} aliases must be an array.`);
    }

    candidate.aliases.forEach((alias, aliasIndex) => {
      if (!isRecord(alias)) {
        fail(`${genre} candidate ${index + 1} alias ${aliasIndex + 1} must be an object.`);
      }

      for (const field of ["title", "artist", "label"]) {
        if (typeof alias[field] !== "string" || !alias[field].trim()) {
          fail(`${genre} candidate ${index + 1} alias ${aliasIndex + 1} missing ${field}.`);
        }
      }
    });
  }

  const key = `${candidate.title.trim()}\u0000${candidate.artist.trim()}`.toLowerCase();

  if (seen.has(key)) {
    fail(`${genre} duplicate candidate: ${candidate.artist} - ${candidate.title}`);
  }

  seen.add(key);
}

function validateChart(chart, slug, expectedPath) {
  if (!isRecord(chart)) {
    fail(`${slug} chart must be an object.`);
  }

  if (chart.provider !== "remote-json") {
    fail(`${slug} provider must be remote-json.`);
  }

  if (chart.sourceType !== "live-online-dynamic") {
    fail(`${slug} sourceType must be live-online-dynamic.`);
  }

  if (chart.genre !== slug) {
    fail(`${slug} chart genre mismatch.`);
  }

  if (typeof chart.generatedAt !== "string" || !Number.isFinite(Date.parse(chart.generatedAt))) {
    fail(`${slug} generatedAt must be a valid timestamp.`);
  }

  if (typeof chart.batchId !== "string" || !chart.batchId.trim()) {
    fail(`${slug} batchId is required.`);
  }

  if (!Array.isArray(chart.candidates) || chart.candidates.length < MIN_CANDIDATES) {
    fail(`${slug} candidates must include at least ${MIN_CANDIDATES}; got ${chart.candidates?.length ?? 0}.`);
  }

  const seen = new Set();
  chart.candidates.forEach((candidate, index) => validateCandidate(candidate, index, slug, seen));

  return {
    generatedAt: chart.generatedAt,
    batchId: chart.batchId,
    count: chart.candidates.length,
    path: expectedPath,
  };
}

function main() {
  const index = readJson(INDEX_PATH);

  if (!isRecord(index)) {
    fail("index.json must be an object.");
  }

  if (index.provider !== "remote-json") {
    fail("index provider must be remote-json.");
  }

  if (index.sourceType !== "live-online-dynamic-index") {
    fail("index sourceType must be live-online-dynamic-index.");
  }

  if (typeof index.generatedAt !== "string" || !Number.isFinite(Date.parse(index.generatedAt))) {
    fail("index generatedAt must be a valid timestamp.");
  }

  if (typeof index.batchId !== "string" || !index.batchId.trim()) {
    fail("index batchId is required.");
  }

  if (!isRecord(index.genres)) {
    fail("index genres must be an object.");
  }

  const indexSlugs = Object.keys(index.genres);

  if (indexSlugs.length !== GENRES.length) {
    fail(`index must contain ${GENRES.length} genres; got ${indexSlugs.length}.`);
  }

  for (const slug of GENRES) {
    const relativePath = index.genres[slug];

    if (relativePath !== `charts/${slug}.json`) {
      fail(`index path for ${slug} must be charts/${slug}.json.`);
    }
  }

  const uniquePaths = new Set(Object.values(index.genres));

  if (uniquePaths.size !== GENRES.length) {
    fail("index contains duplicate chart paths.");
  }

  const results = [];

  for (const slug of GENRES) {
    const relativePath = index.genres[slug];
    const chartPath = join(ROOT, relativePath);
    const chart = readJson(chartPath);
    results.push(validateChart(chart, slug, relativePath));
  }

  const popChartHash = hashFile(join(ROOT, "charts", "pop.json"));
  const legacyHash = hashFile(LEGACY_SNAPSHOT_PATH);

  if (popChartHash !== legacyHash) {
    fail("curated-chart-snapshot.json must exactly mirror charts/pop.json.");
  }

  console.log("Genre chart validation passed.");
  console.log(`Index generatedAt ${index.generatedAt}, batchId ${index.batchId}.`);
  results.forEach((result) => {
    console.log(`${result.path}: ${result.count} candidates, batchId ${result.batchId}.`);
  });
  console.log(`Legacy curated-chart-snapshot.json mirrors charts/pop.json, sha256 ${legacyHash}.`);
}

main();
