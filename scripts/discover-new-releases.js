const NEW_RELEASE_MAX_AGE_DAYS = 30;
const DEFAULT_DISCOVERY_DELAY_MS = Number(process.env.TRADIO_DISCOVERY_DELAY_MS ?? 3200);
const DEFAULT_FETCH_TIMEOUT_MS = 12000;
const MAX_RESULTS_PER_REQUEST = 200;
const TARGET_GLOBAL_NEW_RELEASE_CANDIDATES = 80;
const TARGET_MANDOPOP_NEW_RELEASE_CANDIDATES = 40;

const GLOBAL_COUNTRIES = ["US", "GB", "JP", "KR", "CN", "TW", "HK", "SG"];
const GLOBAL_QUERIES = [
  "new music",
  "new release",
  "new single",
  "pop",
  "dance pop",
  "indie pop",
  "rock",
  "hip hop",
  "k-pop",
  "j-pop",
  "mandopop",
  "2026 single",
];

const MANDOPOP_COUNTRIES = ["TW", "HK", "CN", "SG", "MY", "US", "GB"];
const MANDOPOP_QUERIES = [
  "流行音樂",
  "流行音乐",
  "香港流行",
  "台灣流行",
  "台湾流行",
  "最新單曲",
  "最新单曲",
  "新專輯",
  "新专辑",
  "抖音中文",
  "華語新歌",
  "华语新歌",
  "華語流行",
  "华语流行",
  "中文流行",
  "中文歌",
  "國語流行",
  "国语流行",
  "新歌",
  "新曲",
  "新加坡華語",
  "新加坡华语",
  "馬來西亞華語",
  "马来西亚华语",
  "mandopop",
  "c-pop",
  "chinese pop",
  "cantopop",
  "taiwan pop",
  "hong kong pop",
  "singapore chinese pop",
  "malaysia chinese pop",
  "2026 華語 新歌",
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeToken(value) {
  return cleanString(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseReleaseDate(value) {
  const text = cleanString(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);

  if (!match) {
    return null;
  }

  const releaseDate = match[0];
  const timestamp = Date.parse(`${releaseDate}T00:00:00.000Z`);

  return Number.isFinite(timestamp) ? { releaseDate, timestamp } : null;
}

function isWithinReleaseWindow(releaseDate, generatedAt, maxAgeDays = NEW_RELEASE_MAX_AGE_DAYS) {
  const parsedRelease = parseReleaseDate(releaseDate);
  const generatedAtMs = Date.parse(generatedAt);

  if (!parsedRelease || !Number.isFinite(generatedAtMs)) {
    return false;
  }

  if (parsedRelease.timestamp > generatedAtMs) {
    return false;
  }

  const ageDays = (generatedAtMs - parsedRelease.timestamp) / (24 * 60 * 60 * 1000);

  return ageDays <= maxAgeDays;
}

function getStyleFromGenre(primaryGenreName, fallback) {
  const genre = cleanString(primaryGenreName);

  if (!genre) {
    return [fallback];
  }

  const normalized = genre.toLowerCase();

  if (normalized.includes("pop")) {
    return [genre, fallback].filter((item, index, array) => array.indexOf(item) === index);
  }

  return [genre];
}

function hasCjkText(value) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(cleanString(value));
}

function looksMandopop(result) {
  const titleArtistCollection = [result.trackName, result.artistName, result.collectionName]
    .map(cleanString)
    .join(" ");
  const genreText = cleanString(result.primaryGenreName);
  const genre = genreText.toLowerCase();

  return (
    hasCjkText(titleArtistCollection) ||
    /華語|华语|國語|国语|中文|粵語|粤语|台語|台语/.test(genreText) ||
    genre.includes("mandopop") ||
    genre.includes("c-pop") ||
    genre.includes("chinese") ||
    genre.includes("cantopop") ||
    genre.includes("taiwanese")
  );
}

function buildSearchUrl({ country, query }) {
  const params = new URLSearchParams({
    country,
    entity: "song",
    limit: String(MAX_RESULTS_PER_REQUEST),
    media: "music",
    term: query,
  });

  return `https://itunes.apple.com/search?${params.toString()}`;
}

async function fetchJsonWithTimeout(url, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { error: `HTTP_${response.status}`, results: [] };
    }

    const payload = await response.json();

    return { results: Array.isArray(payload.results) ? payload.results : [] };
  } catch (error) {
    return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), results: [] };
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeItunesSong(result, context) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }

  const title = cleanString(result.trackName);
  const artist = cleanString(result.artistName);
  const parsedReleaseDate = parseReleaseDate(result.releaseDate);

  if (!title || !artist || !parsedReleaseDate) {
    return null;
  }

  if (result.wrapperType && result.wrapperType !== "track") {
    return null;
  }

  if (result.kind && result.kind !== "song") {
    return null;
  }

  const styles = getStyleFromGenre(result.primaryGenreName, context.genre === "mandopop-new-releases" ? "mandopop" : "new-release");
  const sourceUrl = cleanString(result.trackViewUrl) || context.searchUrl;
  const candidate = {
    title,
    artist,
    releaseDate: parsedReleaseDate.releaseDate,
    category: context.genre,
    styles,
    region: context.country,
    source: "itunes-search",
    sourceUrl,
    aliases: [
      {
        artist,
        label: "itunes-original",
        title,
      },
    ],
  };

  if (result.collectionName) {
    candidate.releaseContext = [`iTunes collection: ${cleanString(result.collectionName)}`];
  }

  return candidate;
}

function dedupeByTitleArtist(candidates) {
  const seen = new Set();
  const deduped = [];

  for (const candidate of candidates) {
    const key = `${normalizeToken(candidate.title)}\u0000${normalizeToken(candidate.artist)}`;

    if (!key.trim() || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function sortCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const dateDiff = Date.parse(`${right.releaseDate}T00:00:00.000Z`) - Date.parse(`${left.releaseDate}T00:00:00.000Z`);

    if (dateDiff !== 0) {
      return dateDiff;
    }

    return `${left.artist} ${left.title}`.localeCompare(`${right.artist} ${right.title}`);
  });
}

async function discoverNewReleases({ countries, generatedAt, genre, isEligibleResult, maxAgeDays, queries, targetCandidateCount }) {
  const candidates = [];
  const summary = {
    afterDedupe: 0,
    finalCandidates: 0,
    normalizedResults: 0,
    rawResults: 0,
    requestsAttempted: 0,
    successfulRequests: 0,
    withinWindow: 0,
  };

  for (const country of countries) {
    for (const query of queries) {
      const searchUrl = buildSearchUrl({ country, query });
      summary.requestsAttempted += 1;
      const response = await fetchJsonWithTimeout(searchUrl);

      if (!response.error) {
        summary.successfulRequests += 1;
      } else {
        console.warn(`[discover-new-releases] ${genre} ${country} ${query} failed: ${response.error}`);
      }

      summary.rawResults += response.results.length;

      for (const result of response.results) {
        if (!isEligibleResult(result)) {
          continue;
        }

        const candidate = normalizeItunesSong(result, { country, genre, searchUrl });

        if (!candidate) {
          continue;
        }

        summary.normalizedResults += 1;

        if (!isWithinReleaseWindow(candidate.releaseDate, generatedAt, maxAgeDays)) {
          continue;
        }

        summary.withinWindow += 1;
        candidates.push(candidate);
      }

      const dedupedCount = dedupeByTitleArtist(candidates).length;

      if (dedupedCount >= targetCandidateCount) {
        break;
      }

      if (DEFAULT_DISCOVERY_DELAY_MS > 0) {
        await delay(DEFAULT_DISCOVERY_DELAY_MS);
      }
    }

    if (dedupeByTitleArtist(candidates).length >= targetCandidateCount) {
      break;
    }
  }

  const deduped = sortCandidates(dedupeByTitleArtist(candidates));
  summary.afterDedupe = deduped.length;
  summary.finalCandidates = Math.min(deduped.length, targetCandidateCount);
  summary.targetCandidateCount = targetCandidateCount;

  return {
    candidates: deduped.slice(0, targetCandidateCount),
    summary,
  };
}

async function discoverGlobalNewReleases({ generatedAt, maxAgeDays = NEW_RELEASE_MAX_AGE_DAYS } = {}) {
  return discoverNewReleases({
    countries: GLOBAL_COUNTRIES,
    generatedAt,
    genre: "global-new-releases",
    isEligibleResult: () => true,
    maxAgeDays,
    queries: GLOBAL_QUERIES,
    targetCandidateCount: TARGET_GLOBAL_NEW_RELEASE_CANDIDATES,
  });
}

async function discoverMandopopNewReleases({ generatedAt, maxAgeDays = NEW_RELEASE_MAX_AGE_DAYS } = {}) {
  return discoverNewReleases({
    countries: MANDOPOP_COUNTRIES,
    generatedAt,
    genre: "mandopop-new-releases",
    isEligibleResult: looksMandopop,
    maxAgeDays,
    queries: MANDOPOP_QUERIES,
    targetCandidateCount: TARGET_MANDOPOP_NEW_RELEASE_CANDIDATES,
  });
}

module.exports = {
  NEW_RELEASE_MAX_AGE_DAYS,
  discoverGlobalNewReleases,
  discoverMandopopNewReleases,
  isWithinReleaseWindow,
  normalizeItunesSong,
};
