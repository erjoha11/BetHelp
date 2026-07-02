const desktopList =
  typeof document !== 'undefined' ? document.getElementById('desktop-bet-list') : null;
const desktopStatsGrid =
  typeof document !== 'undefined' ? document.getElementById('desktop-stats-grid') : null;
const desktopSiteCards =
  typeof document !== 'undefined' ? document.getElementById('desktop-site-cards') : null;
const desktopSearch =
  typeof document !== 'undefined' ? document.getElementById('desktop-search') : null;
const desktopStatusFilter =
  typeof document !== 'undefined' ? document.getElementById('desktop-status-filter') : null;
const desktopSiteFilter =
  typeof document !== 'undefined' ? document.getElementById('desktop-site-filter') : null;
const desktopSummary =
  typeof document !== 'undefined' ? document.getElementById('desktop-summary') : null;
const desktopRefresh =
  typeof document !== 'undefined' ? document.getElementById('desktop-refresh') : null;
const desktopReprocess =
  typeof document !== 'undefined' ? document.getElementById('desktop-reprocess') : null;
const desktopMessage =
  typeof document !== 'undefined' ? document.getElementById('desktop-message') : null;

let desktopBets = [];

const formatCurrency = (value) => `${Number(value || 0).toFixed(2)} Kr`;

function formatSignedCurrency(value) {
  const amount = Number(value || 0);
  const sign = amount > 0 ? '+' : '';
  return `${sign}${formatCurrency(amount)}`;
}

function getSettledProfit(bet) {
  if (bet.status === 'won') {
    return Number(bet.profit || 0);
  }

  if (bet.status === 'lost') {
    return -Number(bet.stake || 0);
  }

  return 0;
}

function setMessage(text, isError = false) {
  if (!desktopMessage) {
    return;
  }

  desktopMessage.textContent = text;
  desktopMessage.dataset.state = isError ? 'error' : 'success';
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString();
}

function renderStats(stats) {
  if (!desktopStatsGrid) {
    return;
  }

  const statItems = [
    ['Total Bets', stats.totalBets],
    ['Pending', stats.pendingBets],
    ['Won', stats.wonBets],
    ['Lost', stats.lostBets],
    ['Total Stake', formatCurrency(stats.totalStake)],
    ['Potential Profit', formatCurrency(stats.potentialProfit)],
    ['Settled Profit', formatCurrency(stats.settledProfit)],
    ['ROI', `${Number(stats.roiPercent || 0).toFixed(2)}%`]
  ];

  desktopStatsGrid.innerHTML = statItems
    .map(([label, value]) => `<article class="stat"><h3>${label}</h3><p>${value}</p></article>`)
    .join('');
}

function renderSiteCards(bets) {
  if (!desktopSiteCards) {
    return;
  }

  const grouped = new Map();
  for (const bet of bets) {
    const site = String(bet.bookmaker || 'unknown-site');
    const current = grouped.get(site) || { count: 0, stake: 0, profit: 0 };
    current.count += 1;
    current.stake += Number(bet.stake || 0);
    current.profit += Number(bet.profit || 0);
    grouped.set(site, current);
  }

  const cards = Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([site, totals]) => `
        <article class="desktop-site-card">
          <h3>${site}</h3>
          <p>${totals.count} bet${totals.count === 1 ? '' : 's'}</p>
          <p>Stake: ${formatCurrency(totals.stake)}</p>
          <p>Potential profit: ${formatCurrency(totals.profit)}</p>
        </article>
      `
    );

  desktopSiteCards.innerHTML = cards.length
    ? cards.join('')
    : '<p class="empty">No site data yet.</p>';
}

function updateSiteFilterOptions(bets) {
  if (!desktopSiteFilter) {
    return;
  }

  const selected = desktopSiteFilter.value || 'all';
  const sites = Array.from(new Set((bets || []).map((bet) => String(bet.bookmaker || 'unknown-site')))).sort(
    (a, b) => a.localeCompare(b)
  );

  desktopSiteFilter.innerHTML = ['<option value="all">All sites</option>']
    .concat(sites.map((site) => `<option value="${site}">${site}</option>`))
    .join('');

  if (sites.includes(selected)) {
    desktopSiteFilter.value = selected;
  }
}

function getFilteredBets() {
  const search = String(desktopSearch?.value || '').toLowerCase().trim();
  const status = desktopStatusFilter?.value || 'all';
  const siteFilter = desktopSiteFilter?.value || 'all';

  return desktopBets.filter((bet) => {
    if (status !== 'all' && bet.status !== status) {
      return false;
    }

    const site = String(bet.bookmaker || 'unknown-site');
    if (siteFilter !== 'all' && site !== siteFilter) {
      return false;
    }

    if (!search) {
      return true;
    }

    const legs = Array.isArray(bet.legs) ? bet.legs : [];
    const searchable = [
      bet.name,
      site,
      bet.scenario,
      bet.betType,
      ...legs.map((leg) => `${leg.homeTeam} ${leg.awayTeam}`)
    ]
      .join(' ')
      .toLowerCase();

    return searchable.includes(search);
  });
}

async function updateStatus(id, status) {
  const response = await fetch(`/api/bets/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });

  if (!response.ok) {
    throw new Error('Could not update status');
  }
}

async function removeBet(id) {
  const response = await fetch(`/api/bets/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error('Could not delete bet');
  }
}

function renderTableRows(bets) {
  if (!desktopList) {
    return;
  }

  if (!bets.length) {
    desktopList.innerHTML = '<tr><td colspan="14" class="empty">No bets match current filters.</td></tr>';
    return;
  }

  desktopList.innerHTML = bets
    .map((bet) => {
      const legs = Array.isArray(bet.legs) ? bet.legs : [];
      const gamesCount = legs.length;
      const payout = Number(bet.stake || 0) * Number(bet.odds || 0);
      const settled = getSettledProfit(bet);
      const typeLabel = bet.betType || 'single';
      const scenarioLabel = bet.scenario || 'unknown';
      const summaryMeta = `${typeLabel} - ${scenarioLabel}`;
      const legsMarkup = legs.length
        ? `<div class="legs-inline">${legs
            .slice(0, 2)
            .map((leg) => `${leg.homeTeam} vs ${leg.awayTeam}`)
            .join(' | ')}${legs.length > 2 ? ` +${legs.length - 2} more` : ''}</div>`
        : '';

      return `
        <tr class="history-row">
          <td class="id-cell">${bet.id}</td>
          <td>
            <strong class="bet-main">${bet.name}</strong>
            <div class="bet-sub">${summaryMeta}</div>
            ${legsMarkup}
          </td>
          <td>${formatDateTime(bet.placedAt)}</td>
          <td>${bet.bookmaker || 'unknown-site'}</td>
          <td>${bet.betType || 'single'}</td>
          <td>${gamesCount || '-'}</td>
          <td>${formatCurrency(bet.stake)}</td>
          <td>${Number(bet.odds || 0).toFixed(2)}</td>
          <td>${formatCurrency(payout)}</td>
          <td>${formatCurrency(bet.profit)}</td>
          <td class="${settled > 0 ? 'pos' : settled < 0 ? 'neg' : 'neu'}">${formatSignedCurrency(settled)}</td>
          <td>${Number(bet.confidenceScore || 0).toFixed(2)}</td>
          <td>
            <select class="desktop-status-select status-${bet.status}" data-id="${bet.id}">
              <option value="pending" ${bet.status === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="won" ${bet.status === 'won' ? 'selected' : ''}>Won</option>
              <option value="lost" ${bet.status === 'lost' ? 'selected' : ''}>Lost</option>
            </select>
          </td>
          <td>${bet.screenshot ? `<a href="${bet.screenshot}" target="_blank" rel="noopener noreferrer">View</a>` : '-'}</td>
          <td><button type="button" class="danger desktop-delete" data-id="${bet.id}">Delete</button></td>
        </tr>
      `;
    })
    .join('');
}

function renderSummary(filteredCount, totalCount) {
  if (!desktopSummary) {
    return;
  }

  desktopSummary.textContent = `Showing ${filteredCount} of ${totalCount} bets`;
}

function refreshDesktopTable() {
  const filtered = getFilteredBets();
  renderTableRows(filtered);
  renderSummary(filtered.length, desktopBets.length);
}

async function refreshDesktopData() {
  const [betsResponse, statsResponse] = await Promise.all([fetch('/api/bets'), fetch('/api/stats')]);
  if (!betsResponse.ok || !statsResponse.ok) {
    throw new Error('Could not load desktop view data');
  }

  const betsPayload = await betsResponse.json();
  const statsPayload = await statsResponse.json();
  desktopBets = betsPayload.bets || [];
  updateSiteFilterOptions(desktopBets);
  renderSiteCards(desktopBets);
  renderStats(statsPayload.stats || {});
  refreshDesktopTable();
}

async function reprocessScreenshots() {
  const response = await fetch('/api/bets/reprocess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Could not reprocess screenshots');
  }

  return response.json();
}

if (desktopList) {
  desktopRefresh?.addEventListener('click', () => {
    refreshDesktopData().catch((error) => {
      setMessage(error.message, true);
    });
  });

  desktopReprocess?.addEventListener('click', async () => {
    try {
      setMessage('Reprocessing screenshots...');
      const payload = await reprocessScreenshots();
      setMessage(`Reprocessed ${payload.reprocessed || 0} screenshot groups.`);
      await refreshDesktopData();
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  desktopList.addEventListener('change', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !target.classList.contains('desktop-status-select')) {
      return;
    }

    const id = Number(target.dataset.id);
    try {
      await updateStatus(id, target.value);
      await refreshDesktopData();
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  desktopList.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.classList.contains('desktop-delete')) {
      return;
    }

    const id = Number(target.dataset.id);
    if (!Number.isInteger(id) || id <= 0) {
      return;
    }

    try {
      await removeBet(id);
      await refreshDesktopData();
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  const filterHandler = () => refreshDesktopTable();
  desktopSearch?.addEventListener('input', filterHandler);
  desktopStatusFilter?.addEventListener('change', filterHandler);
  desktopSiteFilter?.addEventListener('change', filterHandler);

  refreshDesktopData().catch((error) => {
    setMessage(error.message, true);
  });
}
