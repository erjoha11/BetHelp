const path = require('node:path');
const { createWorker } = require('tesseract.js');

let worker;

async function getWorker() {
  if (worker) {
    return worker;
  }

  worker = await createWorker('eng');
  return worker;
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

async function extractBetFromScreenshot(filePath) {
  const fallbackName = `Screenshot ${path.basename(filePath)}`;

  try {
    const currentWorker = await getWorker();
    const result = await currentWorker.recognize(filePath);
    const text = String(result.data?.text || '');

    const name = parseName(text) || fallbackName;
    const stake = parseStake(text);
    const odds = parseOdds(text);

    return {
      name,
      stake,
      odds,
      extractionStatus: stake && odds ? 'parsed' : 'partial'
    };
  } catch {
    return {
      name: fallbackName,
      stake: null,
      odds: null,
      extractionStatus: 'failed'
    };
  }
}

module.exports = { extractBetFromScreenshot };
