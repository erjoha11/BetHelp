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

function looksLikeTeamName(value) {
  const normalized = cleanupTeamName(value).toLowerCase();
  if (!normalized || normalized.length < 3) {
    return false;
  }

  if (/\b(hub|today|fri|sat|sun|odds|stake|potential payout|payout|date|id)\b/.test(normalized)) {
    return false;
  }

  if (/\d{1,2}:\d{2}/.test(normalized)) {
    return false;
  }

  return /^[\p{L} .,'-]+$/u.test(normalized);
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

  if (!legs.length) {
    // Some slips list home/away teams on separate lines: Team A \n Team B.
    for (let i = 0; i < lines.length - 1; i += 1) {
      const first = cleanupTeamName(lines[i]);
      const second = cleanupTeamName(lines[i + 1]);

      if (
        first.length >= 3 &&
        second.length >= 3 &&
        looksLikeTeamName(first) &&
        looksLikeTeamName(second) &&
        !hasTooManyDigits(first) &&
        !hasTooManyDigits(second) &&
        first.toLowerCase() !== second.toLowerCase()
      ) {
        legs.push({ homeTeam: first, awayTeam: second, rawLine: `${first} - ${second}` });
        i += 1;
      }
    }
  }

  return dedupeLegs(legs).slice(0, 12);
}

function parseNameFromMarketLine(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => line.length <= 90);

  for (const line of lines) {
    const market = line.match(/^(.+?)\s+(\d+[\.,]\d{2})$/);
    if (!market) {
      continue;
    }

    const candidate = cleanupTeamName(market[1]);
    if (candidate.length >= 4 && /[\p{L}]/u.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

function parseOddsenTicket(text, fallbackName) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const stakeMatch = String(text).match(/stake\s*(\d+(?:[\.,]\d{1,2})?)/i);
  const oddsMatch = String(text).match(/odds\s*(\d+(?:[\.,]\d{1,2})?)/i);
  const stake = stakeMatch ? Number(stakeMatch[1].replace(',', '.')) : null;
  const odds = oddsMatch ? Number(oddsMatch[1].replace(',', '.')) : null;

  const selections = [];
  const selectionPattern = /([\p{L}][\p{L} .'-]{1,40})\s*[\(]?\d+[\.,]\d{2}/u;
  for (const line of lines) {
    const match = line.match(selectionPattern);
    if (!match) {
      continue;
    }

    const candidate = cleanupTeamName(match[1]);
    if (looksLikeTeamName(candidate) && !selections.includes(candidate)) {
      selections.push(candidate);
    }
  }

  const legs = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/internasjonal.*fotball.*vm/i.test(lines[i])) {
      continue;
    }

    const candidates = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 7); j += 1) {
      const candidate = cleanupTeamName(lines[j]);
      if (!looksLikeTeamName(candidate)) {
        continue;
      }

      if (/^hub$/i.test(candidate)) {
        continue;
      }

      candidates.push(candidate);
      if (candidates.length === 2) {
        break;
      }
    }

    if (candidates.length === 2) {
      legs.push({
        homeTeam: candidates[0],
        awayTeam: candidates[1],
        rawLine: `${candidates[0]} - ${candidates[1]}`
      });
    }
  }

  const dedupedLegs = dedupeLegs(legs);
  const name = selections.length
    ? `Double: ${selections.join(' + ')}`
    : buildNameFromLegs(dedupedLegs) || fallbackName;

  return {
    name,
    stake,
    odds,
    status: 'pending',
    legs: dedupedLegs,
    betType: /\bdouble\b/i.test(text) ? 'multi' : 'single',
    scenario: dedupedLegs.length > 1 ? 'multi-game' : 'single-game',
    confidenceScore: Number(
      (
        (stake ? 0.35 : 0) +
        (odds ? 0.35 : 0) +
        (dedupedLegs.length ? 0.2 : 0) +
        (selections.length ? 0.1 : 0)
      ).toFixed(2)
    ),
    extractionStatus: stake || odds || dedupedLegs.length ? 'parsed' : 'partial'
  };
}

function parseStake(text) {
  const innsatsPatterns = [
    /(stake|insats|innsats|bet amount)\s*[:\-]?\s*([\d\s.,]{2,})/i,
    /(stake|insats|innsats|bet amount)\s*[:\-]?\s*[\n\r]+\s*([\d\s.,]{2,})/i
  ];

  for (const pattern of innsatsPatterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const compact = String(match[2]).replace(/\s+/g, '');
    const value = Number(compact.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
    if (Number.isFinite(value) && value > 0) {
      return Number(value.toFixed(2));
    }
  }

  const stakePatterns = [
    /(stake|insats|innsats|bet amount)\s*[:\-]?\s*(\d+[\.,]?\d*)/i,
    /(\d+[\.,]\d{1,2})\s*(kr|sek|k[rtx])/i
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

  // Fallback for OCR where currency tokens are noisy: choose first money-like amount >= 20.
  const candidates = [];
  const amountPattern = /(\d{1,3}(?:[ .]\d{3})*[\.,]\d{2})/g;
  for (const match of String(text || '').matchAll(amountPattern)) {
    const raw = String(match[1]);
    const normalized = raw
      .replace(/\s+/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');
    const value = Number(normalized);
    if (Number.isFinite(value) && value > 0) {
      candidates.push(value);
    }
  }

  const selected = candidates.find((value) => value >= 20);
  if (selected) {
    return Number(selected.toFixed(2));
  }

  return null;
}

function parseStatus(text) {
  const normalized = String(text || '').toLowerCase();
  if (/(\bvunnet\b|\bwon\b|\bvumnet\b|\bunmet\b|\bvmnet\b)/i.test(normalized)) {
    return 'won';
  }

  if (/(\btapt\b|\blost\b)/i.test(normalized)) {
    return 'lost';
  }

  // ComeOn settled cards may miss OCR for the red "Tapt" badge; infer from structure.
  if (
    /\binnsats\b/i.test(normalized) &&
    !/(\bvunnet\b|\bwon\b|cash\s*out|potensiell\s+gevinst|\bapen\b|\bopen\b)/i.test(normalized)
  ) {
    return 'lost';
  }

  return 'pending';
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
    { name: 'oddsen', pattern: /\b[o0]ddsen\b/i },
    { name: 'comeon', pattern: /\bcome\s*on\b|comeon\.com/i },
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

  if (/\b(spilleren|player|malgivende|assists?|scorer|super\s*sub)\b/i.test(text)) {
    return 'player-market';
  }

  if (/\b(over|under|btts|both teams to score|handicap|asian handicap|corners?)\b/i.test(text)) {
    return 'special-market';
  }

  return 'single-game';
}

function parseBetBlocks(text) {
  const normalizedText = String(text || '').replace(/\r/g, '');
  const markerPattern = /\b(bet\s*id|receipt|kvitto|spel\s*id|coupon|kupong|stake|insats)\b/i;

  const lines = normalizedText
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  // ComeOn-style history screenshots often repeat a card header for each bet.
  const cardHeaderPattern = /\b(singel|single|singe[!l]?)\b/i;
  const headerIndexes = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (cardHeaderPattern.test(lines[i])) {
      headerIndexes.push(i);
    }
  }

  if (headerIndexes.length >= 2) {
    const blocks = [];
    for (let i = 0; i < headerIndexes.length; i += 1) {
      const start = headerIndexes[i];
      const end = i + 1 < headerIndexes.length ? headerIndexes[i + 1] : lines.length;
      const sliceStart = Math.max(0, start - 1);
      const block = lines.slice(sliceStart, end).join('\n').trim();
      if (block) {
        blocks.push(block);
      }
    }

    if (blocks.length) {
      return blocks;
    }
  }

  const byEmptyLines = normalizedText
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (byEmptyLines.length > 1) {
    return byEmptyLines;
  }

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
  const name =
    parseNameFromMarketLine(rawText) ||
    buildNameFromLegs(legs) ||
    parseName(rawText) ||
    fallbackName;
  const stake = parseStake(rawText);
  const odds = parseOdds(rawText);
  const status = parseStatus(rawText);
  const betType = /\bdouble\b/i.test(rawText)
    ? 'multi'
    : /\b(singel|single|singe[!l]?)\b/i.test(rawText)
      ? 'single'
      : legs.length > 1
        ? 'multi'
        : 'single';
  const hasUsefulData = Boolean(stake || odds || legs.length > 0);
  const confidenceScore = Number(
    (
      (stake ? 0.3 : 0) +
      (odds ? 0.3 : 0) +
      (legs.length ? 0.2 : 0) +
      (name && name !== fallbackName ? 0.1 : 0) +
      (status !== 'pending' ? 0.1 : 0)
    ).toFixed(2)
  );

  return {
    name,
    stake,
    odds,
    status,
    legs,
    betType,
    scenario: detectScenario(rawText, legs.length),
    confidenceScore,
    extractionStatus: hasUsefulData ? 'parsed' : 'partial'
  };
}

async function extractBetFromScreenshot(filePath) {
  const fallbackName = `Screenshot ${path.basename(filePath)}`;

  try {
    const result = await Tesseract.recognize(filePath, 'eng');
    const text = String(result.data?.text || '');

    const bookmaker = detectBookmaker(text);

    if (bookmaker === 'oddsen') {
      const parsed = parseOddsenTicket(text, fallbackName);
      return {
        ...parsed,
        bookmaker,
        bets: [{ ...parsed, bookmaker }]
      };
    }

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
      status: 'pending',
      legs: [],
      betType: 'single',
      scenario: 'unknown',
      confidenceScore: 0,
      bookmaker: 'unknown-site',
      extractionStatus: 'failed',
      bets: [
        {
          name: fallbackName,
          stake: null,
          odds: null,
          status: 'pending',
          legs: [],
          betType: 'single',
          scenario: 'unknown',
          confidenceScore: 0,
          bookmaker: 'unknown-site',
          extractionStatus: 'failed'
        }
      ]
    };
  }
}

module.exports = {
  extractBetFromScreenshot,
  parseLegs,
  parseBetBlocks,
  parseStake,
  parseStatus,
  parseNameFromMarketLine
};
