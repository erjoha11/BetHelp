const test = require('node:test');
const assert = require('node:assert/strict');
const { createBetLine } = require('../public/app.js');
const { getSafePath } = require('../server.js');

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
