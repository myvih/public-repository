const { existsSync, readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "..");
const MIN_CANDIDATES = 80;
const MIN_NEW_RELEASE_CANDIDATES = 20;
const NEW_RELEASE_MAX_AGE_DAYS = 30;
const NEW_RELEASE_GENRES = new Set(["global-new-releases", "mandopop-new-releases"]);
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

function parseIsoDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return null;
  }

  const timestamp = Date.parse(`${value.trim()}T00:00:00.000Z`);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function failNewReleaseCandidate(candidate, genre, reason) {
  const title = typeof candidate.title === "string" ? candidate.title : "<missing title>";
  const artist = typeof candidate.artist === "string" ? candidate.artist : "<missing artist>";
  const releaseDate = typeof candidate.releaseDate === "string" ? candidate.releaseDate : "<missing releaseDate>";

  fail(`FAILED ${genre}: ${title} / ${artist} / ${releaseDate} / ${reason}`);
}

function validateNewReleaseCandidate(candidate, index, genre, generatedAtMs) {
  const releaseDateMs = parseIsoDateOnly(candidate.releaseDate);

  if (releaseDateMs === null) {
    failNewReleaseCandidate(candidate, genre, `candidate ${index + 1} missing valid ISO releaseDate YYYY-MM-DD`);
  }

  if (releaseDateMs > generatedAtMs) {
    failNewReleaseCandidate(candidate, genre, `candidate ${index + 1} releaseDate after generatedAt`);
  }

  const ageDays = (generatedAtMs - releaseDateMs) / (24 * 60 * 60 * 1000);

  if (ageDays > NEW_RELEASE_MAX_AGE_DAYS) {
    failNewReleaseCandidate(candidate, genre, `candidate ${index + 1} releaseDate outside ${NEW_RELEASE_MAX_AGE_DAYS} days`);
  }
}

function validateCandidate(candidate, index, genre, seen, generatedAtMs) {
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

  if (NEW_RELEASE_GENRES.has(genre)) {
    validateNewReleaseCandidate(candidate, index, genre, generatedAtMs);

    if (typeof candidate.sourceUrl !== "string" || !candidate.sourceUrl.trim()) {
      failNewReleaseCandidate(candidate, genre, `candidate ${index + 1} missing sourceUrl`);
    }
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

  const minCandidates = NEW_RELEASE_GENRES.has(slug) ? MIN_NEW_RELEASE_CANDIDATES : MIN_CANDIDATES;

  if (!Array.isArray(chart.candidates) || chart.candidates.length < minCandidates) {
    fail(`${slug} candidates must include at least ${minCandidates}; got ${chart.candidates?.length ?? 0}.`);
  }

  if (NEW_RELEASE_GENRES.has(slug)) {
    if (!Array.isArray(chart.sourceNotes) || !chart.sourceNotes.some((note) => typeof note === "string" && note.includes("30 days"))) {
      fail(`${slug} sourceNotes must mention the 30 days release window.`);
    }

    if (!Array.isArray(chart.sourceNotes) || !chart.sourceNotes.some((note) => typeof note === "string" && note.toLowerCase().includes("automated"))) {
      fail(`${slug} sourceNotes must mention automated discovery.`);
    }
  }

  const generatedAtMs = Date.parse(chart.generatedAt);
  const seen = new Set();
  chart.candidates.forEach((candidate, index) => validateCandidate(candidate, index, slug, seen, generatedAtMs));

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
