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
    'Team A: stake $10.00, odds 2.50, payout $25.00, profit $15.00'
  );
});

test('getSafePath maps root to index', () => {
  assert.equal(getSafePath('/'), '/index.html');
});

test('getSafePath rejects path traversal attempts', () => {
  assert.equal(getSafePath('/../secret.txt'), null);
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
