const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createBetLine } = require('../public/app.js');
const { getSafePath, server } = require('../server.js');

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
