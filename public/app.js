const form = typeof document !== 'undefined' ? document.getElementById('bet-form') : null;
const list = typeof document !== 'undefined' ? document.getElementById('bet-list') : null;

const formatCurrency = (value) => `$${value.toFixed(2)}`;

function createBetLine(name, stake, odds) {
  const payout = stake * odds;
  const profit = payout - stake;
  return `${name}: stake ${formatCurrency(stake)}, odds ${odds.toFixed(2)}, payout ${formatCurrency(payout)}, profit ${formatCurrency(profit)}`;
}

if (form && list) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const nameValue = document.getElementById('bet-name')?.value.trim() || '';
    const stakeValue = Number(document.getElementById('stake')?.value);
    const oddsValue = Number(document.getElementById('odds')?.value);

    if (!nameValue || !Number.isFinite(stakeValue) || !Number.isFinite(oddsValue)) {
      return;
    }

    const item = document.createElement('li');
    item.textContent = createBetLine(nameValue, stakeValue, oddsValue);
    list.prepend(item);
    form.reset();
  });
}

if (typeof module !== 'undefined') {
  module.exports = { createBetLine };
}
