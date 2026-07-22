const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createBetLine, summarizePhotoSelection } = require('../public/app.js');
const { getSafePath, server } = require('../server.js');
const { normalizeProbability, scanMarkets } = require('../lib/valueBetAgent');

function requestJson(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          payload: raw ? JSON.parse(raw) : {}
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

test('createBetLine returns payout and profit text', () => {
  const line = createBetLine('Team A', 10, 2.5);
  assert.equal(
    line,
    'Team A: stake $10.00, odds 2.50, payout $25.00, profit $15.00'
  );
});

test('summarizePhotoSelection counts only image files', () => {
  const summary = summarizePhotoSelection([
    { type: 'image/jpeg', size: 1024 },
    { type: 'image/png', size: 2048 },
    { type: 'text/plain', size: 999 }
  ]);

  assert.equal(summary.count, 2);
  assert.equal(summary.totalBytes, 3072);
});

test('getSafePath maps root to index', () => {
  assert.equal(getSafePath('/'), '/index.html');
});

test('getSafePath rejects path traversal attempts', () => {
  assert.equal(getSafePath('/../secret.txt'), null);
});

test('server rejects path traversal requests', async (t) => {
  const instance = server.listen(0);
  t.after(() => instance.close());

  const address = instance.address();
  const response = await new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port: address.port, path: '/%2e%2e/server.js' },
      (res) => {
        res.resume();
        resolve(res);
      }
    );
    req.on('error', reject);
  });

  assert.equal(response.statusCode, 403);
});

test('normalizeProbability accepts decimals and percentages', () => {
  assert.equal(normalizeProbability(0.52), 0.52);
  assert.equal(normalizeProbability(52), 0.52);
  assert.equal(normalizeProbability(0), null);
});

test('scanMarkets ranks today value bets by expected value', () => {
  const payload = {
    scanDate: '2026-07-22T00:00:00.000Z',
    markets: [
      {
        eventName: 'Arsenal vs Chelsea',
        marketType: '1x2',
        selection: 'Arsenal',
        bestOdds: 2.4,
        probability: 48,
        startTime: '2026-07-22T18:00:00.000Z'
      },
      {
        eventName: 'Real Madrid vs Sevilla',
        marketType: 'BTTS',
        selection: 'Yes',
        bestOdds: 1.9,
        probability: 57,
        startTime: '2026-07-22T20:00:00.000Z'
      },
      {
        eventName: 'Roma vs Milan',
        marketType: '1x2',
        selection: 'Draw',
        bestOdds: 3.2,
        probability: 25,
        startTime: '2026-07-23T20:00:00.000Z'
      }
    ]
  };

  const result = scanMarkets(payload, new Date('2026-07-22T09:00:00.000Z'));

  assert.equal(result.returnedMarkets, 2);
  assert.equal(result.bestCandidate.selection, 'Arsenal');
  assert.equal(result.markets[0].expectedValuePercent, 15.2);
  assert.equal(result.markets[1].selection, 'Yes');
});

test('value bet scan endpoint returns ranked candidates', async (t) => {
  const instance = server.listen(0);
  t.after(() => instance.close());

  const address = instance.address();
  const response = await requestJson(
    {
      host: '127.0.0.1',
      port: address.port,
      path: '/api/value-bets/scan',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    },
    {
      scanDate: '2026-07-22T00:00:00.000Z',
      markets: [
        {
          eventName: 'Inter vs Lazio',
          marketType: 'Over 2.5',
          selection: 'Over 2.5',
          bestOdds: 2.1,
          fairOdds: 1.92,
          startTime: '2026-07-22T19:45:00.000Z'
        }
      ]
    }
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.returnedMarkets, 1);
  assert.equal(response.payload.bestCandidate.selection, 'Over 2.5');
  assert.equal(response.payload.markets[0].recommendation, 'good-value');
});
