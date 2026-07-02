const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDataFile = path.join(
  os.tmpdir(),
  `bethelp-test-${process.pid}-${Date.now()}-${Math.round(Math.random() * 1e7)}.json`
);

process.env.BETHELP_DATA_FILE = testDataFile;

fs.writeFileSync(testDataFile, JSON.stringify({ nextId: 1, bets: [] }, null, 2));

const { createBetLine } = require('../public/app.js');
const { getSafePath, server } = require('../server.js');
const { addBet } = require('../lib/betStore');
const {
  parseLegs,
  extractBetFromScreenshot,
  parseBetBlocks,
  parseStake,
  parseStatus,
  parseNameFromMarketLine
} = require('../lib/ocrParser');

function requestJson(instance, { method, pathName, payload }) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: instance.address().port,
        path: pathName,
        method,
        headers: body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body)
            }
          : undefined
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          const parsed = raw ? JSON.parse(raw) : null;
          resolve({ statusCode: res.statusCode, body: parsed });
        });
      }
    );

    req.on('error', reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

test.after(() => {
  if (fs.existsSync(testDataFile)) {
    fs.unlinkSync(testDataFile);
  }
});

test.beforeEach(() => {
  fs.writeFileSync(testDataFile, JSON.stringify({ nextId: 1, bets: [] }, null, 2));
});

test('createBetLine returns payout and profit text', () => {
  const line = createBetLine('Team A', 10, 2.5);
  assert.equal(
    line,
    'Team A: stake 10.00 Kr, odds 2.50, payout 25.00 Kr, profit 15.00 Kr'
  );
});

test('getSafePath maps root to index', () => {
  assert.equal(getSafePath('/'), '/index.html');
});

test('getSafePath rejects path traversal attempts', () => {
  assert.equal(getSafePath('/../secret.txt'), null);
});

test('desktop page route is available', async (t) => {
  const instance = server.listen(0);
  t.after(() => instance.close());

  const response = await new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port: instance.address().port,
        path: '/desktop'
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body: raw });
        });
      }
    );

    req.on('error', reject);
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes('BetHelp Desktop'), true);
});

test('reprocess endpoint returns summary successfully', async (t) => {
  const instance = server.listen(0);
  t.after(() => instance.close());

  const response = await requestJson(instance, {
    method: 'POST',
    pathName: '/api/bets/reprocess',
    payload: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(typeof response.body.reprocessed, 'number');
  assert.equal(Array.isArray(response.body.summary), true);
});

test('can create and list bets through API', async (t) => {
  const instance = server.listen(0);
  t.after(() => instance.close());

  const createResponse = await requestJson(instance, {
    method: 'POST',
    pathName: '/api/bets',
    payload: { name: 'Team A', stake: 25, odds: 2.1 }
  });
  assert.equal(createResponse.statusCode, 201);
  assert.equal(createResponse.body.bet.name, 'Team A');

  const listResponse = await requestJson(instance, {
    method: 'GET',
    pathName: '/api/bets'
  });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.body.bets.length, 1);
  assert.equal(listResponse.body.bets[0].profit, 27.5);
});

test('stats and status update endpoints reflect results', async (t) => {
  const instance = server.listen(0);
  t.after(() => instance.close());

  const createWonCandidate = await requestJson(instance, {
    method: 'POST',
    pathName: '/api/bets',
    payload: { name: 'Bet 1', stake: 50, odds: 2.0 }
  });

  const createLostCandidate = await requestJson(instance, {
    method: 'POST',
    pathName: '/api/bets',
    payload: { name: 'Bet 2', stake: 30, odds: 3.0 }
  });

  await requestJson(instance, {
    method: 'PATCH',
    pathName: `/api/bets/${createWonCandidate.body.bet.id}/status`,
    payload: { status: 'won' }
  });

  await requestJson(instance, {
    method: 'PATCH',
    pathName: `/api/bets/${createLostCandidate.body.bet.id}/status`,
    payload: { status: 'lost' }
  });

  const statsResponse = await requestJson(instance, {
    method: 'GET',
    pathName: '/api/stats'
  });

  assert.equal(statsResponse.statusCode, 200);
  assert.equal(statsResponse.body.stats.totalBets, 2);
  assert.equal(statsResponse.body.stats.wonBets, 1);
  assert.equal(statsResponse.body.stats.lostBets, 1);
  assert.equal(statsResponse.body.stats.settledProfit, 20);
  assert.equal(statsResponse.body.stats.roiPercent, 25);
});

test('invalid status update returns validation error', async (t) => {
  const instance = server.listen(0);
  t.after(() => instance.close());

  const createResponse = await requestJson(instance, {
    method: 'POST',
    pathName: '/api/bets',
    payload: { name: 'Team A', stake: 20, odds: 1.9 }
  });

  const updateResponse = await requestJson(instance, {
    method: 'PATCH',
    pathName: `/api/bets/${createResponse.body.bet.id}/status`,
    payload: { status: 'nope' }
  });

  assert.equal(updateResponse.statusCode, 400);
});

test('screenshot-source bet can be created without typed fields', () => {
  const bet = addBet({
    source: 'screenshot',
    screenshot: '/uploads/example.png',
    extractionStatus: 'failed'
  });

  assert.equal(bet.source, 'screenshot');
  assert.equal(bet.name.startsWith('Imported bet '), true);
  assert.equal(bet.stake, 0);
  assert.equal(bet.odds, 1);
});

test('parseLegs extracts multiple games from OCR text', () => {
  const text = [
    'Arsenal vs Chelsea',
    'Liverpool - Tottenham',
    'Stake 100 KR',
    'Total Odds 2.24'
  ].join('\n');

  const legs = parseLegs(text);
  assert.equal(legs.length, 2);
  assert.equal(legs[0].homeTeam, 'Arsenal');
  assert.equal(legs[0].awayTeam, 'Chelsea');
  assert.equal(legs[1].homeTeam, 'Liverpool');
  assert.equal(legs[1].awayTeam, 'Tottenham');
});

test('screenshot-source bet stores extracted multi-game legs', () => {
  const bet = addBet({
    source: 'screenshot',
    name: 'Arsenal vs Chelsea + 1 more game',
    stake: 100,
    odds: 2.24,
    bookmaker: 'bet365',
    scenario: 'multi-game',
    betType: 'multi',
    legs: [
      { homeTeam: 'Arsenal', awayTeam: 'Chelsea' },
      { homeTeam: 'Liverpool', awayTeam: 'Tottenham' }
    ],
    screenshot: '/uploads/example.png',
    extractionStatus: 'parsed'
  });

  assert.equal(bet.betType, 'multi');
  assert.equal(bet.bookmaker, 'bet365');
  assert.equal(bet.scenario, 'multi-game');
  assert.equal(bet.legs.length, 2);
  assert.equal(bet.legs[0].homeTeam, 'Arsenal');
});

test('extractBetFromScreenshot returns fallback structured bets for unreadable image', async () => {
  const parsed = await extractBetFromScreenshot('/this/file/does-not-exist.png');
  assert.equal(Array.isArray(parsed.bets), true);
  assert.equal(parsed.bets.length >= 1, true);
  assert.equal(parsed.bookmaker, 'unknown-site');
});

test('parseBetBlocks splits ComeOn singel cards into multiple bets', () => {
  const text = [
    'Vunnet Singel',
    'Odegaard, Martin 3.73',
    'Elfenbenskysten - Norge',
    '250,00 kr',
    'Tapt Singel',
    'Haaland, Erling Braut 5.00',
    'Elfenbenskysten - Norge',
    '100,00 kr',
    'Tapt Singel',
    'Uavgjort 3.40',
    'Elfenbenskysten - Norge',
    '400,00 kr'
  ].join('\n');

  const blocks = parseBetBlocks(text);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].includes('Odegaard'), true);
  assert.equal(blocks[1].includes('Haaland'), true);
  assert.equal(blocks[2].includes('Uavgjort'), true);
});

test('parseStake reads Norwegian Innsats value', () => {
  const text = ['Tapt Singel', 'Innsats', '400,00 kr'].join('\n');
  assert.equal(parseStake(text), 400);
});

test('parseStatus maps Vunnet/Tapt to won/lost', () => {
  assert.equal(parseStatus('Vunnet Singel'), 'won');
  assert.equal(parseStatus('unmet. singe!'), 'won');
  assert.equal(parseStatus('Vumnet singel'), 'won');
  assert.equal(parseStatus('Tapt Singel'), 'lost');
  assert.equal(parseStatus('Singel'), 'pending');
});

test('parseNameFromMarketLine extracts player market title from line with odds', () => {
  const text = ['Fernandes, Bruno 2.05', 'Innsats 100,00 kr'].join('\n');
  assert.equal(parseNameFromMarketLine(text), 'Fernandes, Bruno');
});

test('parseLegs extracts stacked team lines from Oddsen-style format', () => {
  const text = ['Spania', 'Osterrike', 'HUB', 'Portugal', 'Kroatia', 'HUB'].join('\n');
  const legs = parseLegs(text);
  assert.equal(legs.length >= 2, true);
  assert.equal(legs[0].homeTeam, 'Spania');
  assert.equal(legs[0].awayTeam, 'Osterrike');
});
