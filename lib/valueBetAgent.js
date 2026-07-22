function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeProbability(value) {
  const numeric = toNumber(value);
  if (numeric === null) {
    return null;
  }

  if (numeric > 0 && numeric <= 1) {
    return numeric;
  }

  if (numeric > 1 && numeric <= 100) {
    return numeric / 100;
  }

  return null;
}

function normalizeOdds(value) {
  const numeric = toNumber(value);
  return numeric !== null && numeric > 1 ? numeric : null;
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isSameUtcDay(left, right) {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

function deriveConfidenceScore(probability, expectedValue, inputScore, hasStartTime) {
  const provided = normalizeProbability(inputScore);
  if (provided !== null) {
    return Number(provided.toFixed(2));
  }

  const probabilityComponent = clamp(probability * 0.45, 0, 0.45);
  const valueComponent = clamp(Math.max(expectedValue, 0) * 2.5, 0, 0.35);
  const timingComponent = hasStartTime ? 0.1 : 0.05;
  const baseline = 0.1;

  return Number(clamp(baseline + probabilityComponent + valueComponent + timingComponent, 0, 0.99).toFixed(2));
}

function deriveRecommendation(expectedValuePercent, probabilityPercent) {
  if (expectedValuePercent >= 8 && probabilityPercent >= 55) {
    return 'strong-value';
  }

  if (expectedValuePercent >= 4 && probabilityPercent >= 45) {
    return 'good-value';
  }

  if (expectedValuePercent > 0) {
    return 'lean-value';
  }

  return 'pass';
}

function buildRationale(candidate) {
  return `${candidate.selection} in ${candidate.marketType} shows ${candidate.expectedValuePercent.toFixed(2)}% EV with ${candidate.estimatedProbabilityPercent.toFixed(2)}% estimated probability at ${candidate.bestOdds.toFixed(2)} odds.`;
}

function normalizeMarket(entry) {
  const eventName = String(entry?.eventName || entry?.event || entry?.match || '').trim();
  const marketType = String(entry?.marketType || entry?.market || entry?.type || '').trim();
  const selection = String(entry?.selection || entry?.pick || entry?.outcome || '').trim();
  const bookmaker = String(entry?.bookmaker || entry?.site || 'unknown-site').trim() || 'unknown-site';
  const bestOdds = normalizeOdds(entry?.bestOdds ?? entry?.odds);
  const fairOdds = normalizeOdds(entry?.fairOdds);
  const probability =
    normalizeProbability(entry?.probability) ??
    normalizeProbability(entry?.estimatedProbability) ??
    (fairOdds ? Number((1 / fairOdds).toFixed(6)) : null);
  const startTime = toIsoDate(entry?.startTime ?? entry?.kickoff ?? entry?.startsAt);

  if (!eventName || !marketType || !selection || bestOdds === null || probability === null) {
    return null;
  }

  const impliedProbability = 1 / bestOdds;
  const estimatedFairOdds = Number((1 / probability).toFixed(2));
  const edge = probability - impliedProbability;
  const expectedValue = probability * bestOdds - 1;
  const confidenceScore = deriveConfidenceScore(
    probability,
    expectedValue,
    entry?.confidence ?? entry?.confidenceScore,
    Boolean(startTime)
  );
  const expectedValuePercent = Number((expectedValue * 100).toFixed(2));
  const estimatedProbabilityPercent = Number((probability * 100).toFixed(2));

  return {
    eventName,
    marketType,
    selection,
    bookmaker,
    startTime,
    bestOdds: Number(bestOdds.toFixed(2)),
    fairOdds: estimatedFairOdds,
    impliedProbabilityPercent: Number((impliedProbability * 100).toFixed(2)),
    estimatedProbabilityPercent,
    edgePercent: Number((edge * 100).toFixed(2)),
    expectedValuePercent,
    confidenceScore,
    recommendation: deriveRecommendation(expectedValuePercent, estimatedProbabilityPercent),
    rationale: '',
    rankingScore: Number(
      (
        expectedValuePercent * 0.6 +
        estimatedProbabilityPercent * 0.3 +
        confidenceScore * 10
      ).toFixed(2)
    )
  };
}

function scanMarkets(payload = {}, now = new Date()) {
  const markets = Array.isArray(payload.markets) ? payload.markets : null;
  if (!markets || !markets.length) {
    throw new Error('markets must be a non-empty array');
  }

  const scanDate = toIsoDate(payload.scanDate) || now.toISOString();
  const onlyToday = payload.onlyToday !== false;
  const limit = Math.max(1, Math.min(50, Number(payload.limit) || 10));
  const minEdgePercent = Number.isFinite(Number(payload.minEdgePercent))
    ? Number(payload.minEdgePercent)
    : 0;
  const minProbabilityPercent = Number.isFinite(Number(payload.minProbabilityPercent))
    ? Number(payload.minProbabilityPercent)
    : 0;

  const normalized = markets.map((entry) => normalizeMarket(entry)).filter(Boolean);
  const scanDateValue = new Date(scanDate);
  const filtered = normalized
    .filter((candidate) => {
      if (!onlyToday || !candidate.startTime) {
        return true;
      }

      return isSameUtcDay(new Date(candidate.startTime), scanDateValue);
    })
    .filter(
      (candidate) =>
        candidate.expectedValuePercent > 0 &&
        candidate.edgePercent >= minEdgePercent &&
        candidate.estimatedProbabilityPercent >= minProbabilityPercent
    )
    .map((candidate) => ({
      ...candidate,
      rationale: buildRationale(candidate)
    }))
    .sort((left, right) => {
      if (right.expectedValuePercent !== left.expectedValuePercent) {
        return right.expectedValuePercent - left.expectedValuePercent;
      }

      if (right.estimatedProbabilityPercent !== left.estimatedProbabilityPercent) {
        return right.estimatedProbabilityPercent - left.estimatedProbabilityPercent;
      }

      return right.confidenceScore - left.confidenceScore;
    });

  const limited = filtered.slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    scanDate,
    totalMarkets: markets.length,
    analyzedMarkets: normalized.length,
    returnedMarkets: limited.length,
    bestCandidate: limited[0] || null,
    markets: limited
  };
}

module.exports = {
  normalizeProbability,
  scanMarkets
};
