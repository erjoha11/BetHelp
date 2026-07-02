const fs = require('node:fs');
const path = require('node:path');

function getDataFilePath() {
  const override = process.env.BETHELP_DATA_FILE;
  if (override) {
    return path.resolve(override);
  }

  return path.join(__dirname, '..', 'data', 'bets.json');
}

function ensureStoreFile() {
  const dataFilePath = getDataFilePath();
  if (!fs.existsSync(dataFilePath)) {
    fs.mkdirSync(path.dirname(dataFilePath), { recursive: true });
    fs.writeFileSync(
      dataFilePath,
      JSON.stringify({ nextId: 1, bets: [] }, null, 2) + '\n',
      'utf8'
    );
  }
}

function readStore() {
  const dataFilePath = getDataFilePath();
  ensureStoreFile();
  const raw = fs.readFileSync(dataFilePath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object') {
    return { nextId: 1, bets: [] };
  }

  return {
    nextId: Number.isInteger(parsed.nextId) && parsed.nextId > 0 ? parsed.nextId : 1,
    bets: Array.isArray(parsed.bets) ? parsed.bets : []
  };
}

function writeStore(store) {
  const dataFilePath = getDataFilePath();
  fs.writeFileSync(dataFilePath, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

function listBets() {
  const store = readStore();
  return [...store.bets].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function validateStatus(status) {
  return status === 'pending' || status === 'won' || status === 'lost';
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function addBet(input) {
  const name = String(input.name || '').trim();
  const stake = toNumber(input.stake);
  const odds = toNumber(input.odds);
  const source = String(input.source || 'manual').trim() || 'manual';
  const extractionStatus = String(input.extractionStatus || 'unknown');

  if (source === 'manual') {
    if (!name) {
      throw new Error('Bet name is required');
    }

    if (stake === null || stake <= 0) {
      throw new Error('Stake must be greater than 0');
    }

    if (odds === null || odds <= 1) {
      throw new Error('Decimal odds must be greater than 1');
    }
  }

  const store = readStore();
  const now = new Date().toISOString();
  const normalizedName = name || `Imported bet ${new Date().toLocaleString()}`;
  const normalizedStake = stake !== null && stake > 0 ? Number(stake.toFixed(2)) : 0;
  const normalizedOdds = odds !== null && odds > 1 ? Number(odds.toFixed(2)) : 1;
  const payout = Number((normalizedStake * normalizedOdds).toFixed(2));
  const profit = Number((payout - normalizedStake).toFixed(2));

  const bet = {
    id: store.nextId,
    name: normalizedName,
    stake: normalizedStake,
    odds: normalizedOdds,
    payout,
    profit,
    status: 'pending',
    source,
    extractionStatus,
    screenshot: input.screenshot || null,
    placedAt: input.placedAt || now,
    createdAt: now,
    updatedAt: now
  };

  store.nextId += 1;
  store.bets.push(bet);
  writeStore(store);

  return bet;
}

function updateBetStatus(id, status) {
  if (!validateStatus(status)) {
    throw new Error('Status must be one of: pending, won, lost');
  }

  const store = readStore();
  const target = store.bets.find((bet) => bet.id === id);

  if (!target) {
    return null;
  }

  target.status = status;
  target.updatedAt = new Date().toISOString();
  writeStore(store);

  return target;
}

function computeStats() {
  const bets = listBets();
  const stats = {
    totalBets: bets.length,
    pendingBets: 0,
    wonBets: 0,
    lostBets: 0,
    totalStake: 0,
    potentialPayout: 0,
    potentialProfit: 0,
    settledStake: 0,
    settledProfit: 0,
    averageOdds: 0,
    roiPercent: 0
  };

  for (const bet of bets) {
    stats.totalStake += bet.stake;
    stats.potentialPayout += bet.payout;
    stats.potentialProfit += bet.profit;

    if (bet.status === 'pending') {
      stats.pendingBets += 1;
      continue;
    }

    stats.settledStake += bet.stake;

    if (bet.status === 'won') {
      stats.wonBets += 1;
      stats.settledProfit += bet.profit;
    } else {
      stats.lostBets += 1;
      stats.settledProfit -= bet.stake;
    }
  }

  if (bets.length > 0) {
    const sumOdds = bets.reduce((acc, bet) => acc + bet.odds, 0);
    stats.averageOdds = Number((sumOdds / bets.length).toFixed(2));
  }

  if (stats.settledStake > 0) {
    stats.roiPercent = Number(((stats.settledProfit / stats.settledStake) * 100).toFixed(2));
  }

  stats.totalStake = Number(stats.totalStake.toFixed(2));
  stats.potentialPayout = Number(stats.potentialPayout.toFixed(2));
  stats.potentialProfit = Number(stats.potentialProfit.toFixed(2));
  stats.settledStake = Number(stats.settledStake.toFixed(2));
  stats.settledProfit = Number(stats.settledProfit.toFixed(2));

  return stats;
}

module.exports = {
  addBet,
  computeStats,
  listBets,
  readStore,
  updateBetStatus,
  validateStatus
};
