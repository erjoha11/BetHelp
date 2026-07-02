const path = require('node:path');
const Tesseract = require('tesseract.js');

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/[|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanupTeamName(value) {
  return normalizeWhitespace(value)
    .replace(/[\]\[(){}]/g, '')
    .replace(/\b(odds|stake|insats|kr|sek|single|double|triple|combo|system)\b/gi, '')
    .trim();
}

function hasTooManyDigits(value) {
  const digits = (value.match(/\d/g) || []).length;
  return digits >= Math.max(3, Math.floor(value.length * 0.25));
}

function splitTeamLine(line) {
  const normalized = normalizeWhitespace(line).replace(/\s+@\s*\d+[\.,]\d+/gi, '').trim();
  const patterns = [
    /^(.*?)\s+vs\.?\s+(.*?)$/i,
    /^(.*?)\s+v\s+(.*?)$/i,
    /^(.*?)\s+-\s+(.*?)$/i,
    /^(.*?)\s+[-–]\s+(.*?)$/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }

    const homeTeam = cleanupTeamName(match[1]);
    const awayTeam = cleanupTeamName(match[2]);

    if (!homeTeam || !awayTeam) {
      continue;
    }

    if (homeTeam.length < 2 || awayTeam.length < 2) {
      continue;
    }

    if (hasTooManyDigits(homeTeam) || hasTooManyDigits(awayTeam)) {
      continue;
    }

    return { homeTeam, awayTeam, rawLine: normalized };
  }

  return null;
}

function dedupeLegs(legs) {
  const seen = new Set();
  const unique = [];

  for (const leg of legs) {
    const key = `${leg.homeTeam.toLowerCase()}::${leg.awayTeam.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(leg);
  }

  return unique;
}

function parseLegs(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => line.length >= 5 && line.length <= 90);

  const legs = [];
  for (const line of lines) {
    const parsed = splitTeamLine(line);
    if (parsed) {
      legs.push(parsed);
    }
  }

  return dedupeLegs(legs).slice(0, 12);
}

function parseStake(text) {
  const stakePatterns = [
    /(stake|insats|bet amount)\s*[:\-]?\s*(\d+[\.,]?\d*)/i,
    /(\d+[\.,]\d{1,2})\s*(kr|sek)/i
  ];

  for (const pattern of stakePatterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const raw = match[2] || match[1];
    const value = Number(String(raw).replace(',', '.'));
    if (Number.isFinite(value) && value > 0) {
      return Number(value.toFixed(2));
    }
  }

  return null;
}

function parseOdds(text) {
  const oddsPatterns = [
    /(odds|total odds)\s*[:\-]?\s*(\d+[\.,]\d+)/i,
    /@\s*(\d+[\.,]\d+)/i,
    /\b(1\.[0-9]{2}|[2-9]\.[0-9]{2}|[1-9][0-9]\.[0-9]{2})\b/
  ];

  for (const pattern of oddsPatterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const raw = match[2] || match[1];
    const value = Number(String(raw).replace(',', '.'));
    if (Number.isFinite(value) && value > 1) {
      return Number(value.toFixed(2));
    }
  }

  return null;
}

function parseName(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\d+[\.,]?\d*$/.test(line));

  for (const line of lines) {
    if (line.length >= 6 && line.length <= 80) {
      return line;
    }
  }

  return null;
}

function buildNameFromLegs(legs) {
  if (!legs.length) {
    return null;
  }

  const first = `${legs[0].homeTeam} vs ${legs[0].awayTeam}`;
  if (legs.length === 1) {
    return first;
  }

  return `${first} + ${legs.length - 1} more game${legs.length > 2 ? 's' : ''}`;
}

function detectBookmaker(text) {
  const catalog = [
    { name: 'bet365', pattern: /\bbet\s*365\b/i },
    { name: 'unibet', pattern: /\bunibet\b/i },
    { name: 'betsson', pattern: /\bbetsson\b/i },
    { name: 'svenska-spel', pattern: /\bsvenska\s*spel\b/i },
    { name: 'atg', pattern: /\batg\b/i },
    { name: 'pinnacle', pattern: /\bpinnacle\b/i },
    { name: 'nordicbet', pattern: /\bnordic\s*bet\b/i }
  ];

  for (const candidate of catalog) {
    if (candidate.pattern.test(text)) {
      return candidate.name;
    }
  }

  return 'unknown-site';
}

function detectScenario(text, legsCount) {
  if (legsCount > 1) {
    return 'multi-game';
  }

  if (/\b(over|under|btts|both teams to score|handicap|asian handicap|corners?)\b/i.test(text)) {
    return 'special-market';
  }

  return 'single-game';
}

function parseBetBlocks(text) {
  const normalizedText = String(text || '').replace(/\r/g, '');
  const markerPattern = /\b(bet\s*id|receipt|kvitto|spel\s*id|coupon|kupong|stake|insats)\b/i;

  const byEmptyLines = normalizedText
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (byEmptyLines.length > 1) {
    return byEmptyLines;
  }

  const lines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks = [];
  let current = [];

  for (const line of lines) {
    if (markerPattern.test(line) && current.length >= 4) {
      blocks.push(current.join('\n'));
      current = [line];
      continue;
    }

    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current.join('\n'));
  }

  return blocks.length ? blocks : [normalizedText];
}

function parseSingleBet(rawText, fallbackName) {
  const legs = parseLegs(rawText);
  const name = buildNameFromLegs(legs) || parseName(rawText) || fallbackName;
  const stake = parseStake(rawText);
  const odds = parseOdds(rawText);
  const hasUsefulData = Boolean(stake || odds || legs.length > 0);

  return {
    name,
    stake,
    odds,
    legs,
    betType: legs.length > 1 ? 'multi' : 'single',
    scenario: detectScenario(rawText, legs.length),
    extractionStatus: hasUsefulData ? 'parsed' : 'partial'
  };
}

async function extractBetFromScreenshot(filePath) {
  const fallbackName = `Screenshot ${path.basename(filePath)}`;

  try {
    const result = await Tesseract.recognize(filePath, 'eng');
    const text = String(result.data?.text || '');

    const bookmaker = detectBookmaker(text);
    const blocks = parseBetBlocks(text);
    const bets = blocks
      .map((block, index) => parseSingleBet(block, `${fallbackName} #${index + 1}`))
      .filter((bet) => bet.extractionStatus === 'parsed');

    const normalizedBets = bets.length ? bets : [parseSingleBet(text, fallbackName)];
    const primary = normalizedBets[0];

    return {
      ...primary,
      bookmaker,
      bets: normalizedBets.map((bet) => ({ ...bet, bookmaker }))
    };
  } catch {
    return {
      name: fallbackName,
      stake: null,
      odds: null,
      legs: [],
      betType: 'single',
      scenario: 'unknown',
      bookmaker: 'unknown-site',
      extractionStatus: 'failed',
      bets: [
        {
          name: fallbackName,
          stake: null,
          odds: null,
          legs: [],
          betType: 'single',
          scenario: 'unknown',
          bookmaker: 'unknown-site',
          extractionStatus: 'failed'
        }
      ]
    };
  }
}

module.exports = { extractBetFromScreenshot, parseLegs };
