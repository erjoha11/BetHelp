const form = typeof document !== 'undefined' ? document.getElementById('upload-form') : null;
const list = typeof document !== 'undefined' ? document.getElementById('bet-list') : null;
const statsGrid = typeof document !== 'undefined' ? document.getElementById('stats-grid') : null;
const formMessage = typeof document !== 'undefined' ? document.getElementById('form-message') : null;
const screenshotInput = typeof document !== 'undefined' ? document.getElementById('screenshot') : null;
const batchInput = typeof document !== 'undefined' ? document.getElementById('batch-screenshots') : null;
const batchUploadButton =
  typeof document !== 'undefined' ? document.getElementById('batch-upload-button') : null;
const pasteButton = typeof document !== 'undefined' ? document.getElementById('paste-button') : null;
const pasteTarget = typeof document !== 'undefined' ? document.getElementById('paste-target') : null;
const historySearch = typeof document !== 'undefined' ? document.getElementById('history-search') : null;
const historyStatusFilter =
  typeof document !== 'undefined' ? document.getElementById('history-status-filter') : null;
const historySiteFilter =
  typeof document !== 'undefined' ? document.getElementById('history-site-filter') : null;
const historySummary = typeof document !== 'undefined' ? document.getElementById('history-summary') : null;
const historyDensity = typeof document !== 'undefined' ? document.getElementById('history-density') : null;
const historyTableWrap = typeof document !== 'undefined' ? document.querySelector('.table-wrap') : null;
const historyColumnToggles =
  typeof document !== 'undefined' ? document.querySelectorAll('[data-history-col]') : [];

let allBets = [];

const formatCurrency = (value) => `${value.toFixed(2)} Kr`;

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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

function createBetLine(name, stake, odds) {
  const payout = stake * odds;
  const profit = payout - stake;
  return `${name}: stake ${formatCurrency(stake)}, odds ${odds.toFixed(2)}, payout ${formatCurrency(payout)}, profit ${formatCurrency(profit)}`;
}

function setMessage(text, isError = false) {
  if (!formMessage) {
    return;
  }

  formMessage.textContent = text;
  formMessage.dataset.state = isError ? 'error' : 'success';
}

function assignImageFileToInput(file) {
  if (!screenshotInput || !file) {
    return false;
  }

  const transfer = new DataTransfer();
  transfer.items.add(file);
  screenshotInput.files = transfer.files;
  return true;
}

function handlePasteEvent(event) {
  const clipboardItems = event.clipboardData?.items || [];
  for (const item of clipboardItems) {
    if (!item.type.startsWith('image/')) {
      continue;
    }

    const file = item.getAsFile();
    if (!file) {
      continue;
    }

    const namedFile = new File([file], `clipboard-${Date.now()}.png`, { type: file.type });
    assignImageFileToInput(namedFile);
    setMessage('Clipboard image attached. You can submit now.');
    event.preventDefault();
    return;
  }
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

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().trim();
}

function buildSiteFilterOptions(bets) {
  if (!historySiteFilter) {
    return;
  }

  const previous = historySiteFilter.value || 'all';
  const sites = Array.from(
    new Set(
      (bets || [])
        .map((bet) => String(bet.bookmaker || 'unknown-site').trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  historySiteFilter.innerHTML = ['<option value="all">All sites</option>']
    .concat(sites.map((site) => `<option value="${site}">${site}</option>`))
    .join('');

  if (sites.includes(previous)) {
    historySiteFilter.value = previous;
  }
}

function getFilteredBets() {
  const searchTerm = normalizeSearchText(historySearch?.value || '');
  const statusFilter = historyStatusFilter?.value || 'all';
  const siteFilter = historySiteFilter?.value || 'all';

  return allBets.filter((bet) => {
    if (statusFilter !== 'all' && bet.status !== statusFilter) {
      return false;
    }

    const site = String(bet.bookmaker || 'unknown-site');
    if (siteFilter !== 'all' && site !== siteFilter) {
      return false;
    }

    if (!searchTerm) {
      return true;
    }

    const legs = Array.isArray(bet.legs) ? bet.legs : [];
    const haystack = [
      bet.name,
      bet.selection,
      site,
      bet.scenario,
      bet.betType,
      ...legs.map((leg) => `${leg.homeTeam} ${leg.awayTeam}`)
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(searchTerm);
  });
}

function renderHistorySummary(filteredCount, totalCount) {
  if (!historySummary) {
    return;
  }

  historySummary.textContent = `Showing ${filteredCount} of ${totalCount} bets`;
}

function computeStatsFromBets(bets) {
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
    const stake = Number(bet.stake || 0);
    const odds = Number(bet.odds || 0);
    const payout = Number(bet.payout || stake * odds);
    const profit = Number(bet.profit || payout - stake);

    stats.totalStake += stake;
    stats.potentialPayout += payout;
    stats.potentialProfit += profit;

    if (bet.status === 'pending') {
      stats.pendingBets += 1;
      continue;
    }

    stats.settledStake += stake;

    if (bet.status === 'won') {
      stats.wonBets += 1;
      stats.settledProfit += profit;
    } else {
      stats.lostBets += 1;
      stats.settledProfit -= stake;
    }
  }

  if (bets.length > 0) {
    const sumOdds = bets.reduce((acc, bet) => acc + Number(bet.odds || 0), 0);
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

function renderStats(stats) {
  if (!statsGrid) {
    return;
  }

  const statItems = [
    ['Total Bets', stats.totalBets],
    ['Pending', stats.pendingBets],
    ['Won', stats.wonBets],
    ['Lost', stats.lostBets],
    ['Total Stake', formatCurrency(stats.totalStake)],
    ['Potential Payout', formatCurrency(stats.potentialPayout)],
    ['Potential Profit', formatCurrency(stats.potentialProfit)],
    ['Settled Profit', formatCurrency(stats.settledProfit)],
    ['Average Odds', Number(stats.averageOdds || 0).toFixed(2)],
    ['ROI (Settled)', `${Number(stats.roiPercent || 0).toFixed(2)}%`]
  ];

  statsGrid.innerHTML = statItems
    .map(
      ([label, value]) =>
        `<article class="stat"><h3>${label}</h3><p>${value}</p></article>`
    )
    .join('');
}

function renderBets(bets) {
  if (!list) {
    return;
  }

  if (!bets.length) {
    list.innerHTML =
      '<tr><td colspan="15" class="empty">No matching bets. Try changing filters or upload a new screenshot.</td></tr>';
    return;
  }

  list.innerHTML = bets
    .map(
      (bet) => {
        const legs = Array.isArray(bet.legs) ? bet.legs : [];
        const gamesCount = legs.length;
        const payout = Number(bet.stake || 0) * Number(bet.odds || 0);
        const settled = getSettledProfit(bet);
        const typeLabel = bet.betType || 'single';
        const extractionLabel = bet.extractionStatus || 'unknown';
        const scenarioLabel = bet.scenario || 'unknown';
        const siteLabel = escapeHtml(bet.bookmaker || 'unknown-site');
        const selectionText = escapeHtml(bet.selection || '-');
        const legsSummary = legs.length
          ? legs
              .slice(0, 2)
              .map((leg) => `${leg.homeTeam} vs ${leg.awayTeam}`)
              .join(' | ')
          : 'No game breakdown';
        const selectionLabel = bet.selection ? `selection: ${bet.selection}` : 'selection: -';
        const fullBetSummary = `${bet.name} | ${selectionLabel} | ${typeLabel} | ${extractionLabel} | ${legsSummary}`;
        const escapedLegsSummary = escapeHtml(legsSummary);
        const escapedTypeLabel = escapeHtml(typeLabel);
        const escapedScenarioLabel = escapeHtml(scenarioLabel);
        const escapedExtractionLabel = escapeHtml(extractionLabel);

        return `
        <tr class="history-row row-${bet.status}">
          <td class="id-cell sticky-col sticky-id col-id">${bet.id}</td>
          <td class="sticky-col sticky-bet col-bet">
            <div class="bet-cell">
              <button type="button" class="bet-main bet-expand" title="${escapeHtml(fullBetSummary)}">${escapeHtml(bet.name)}</button>
              <p class="bet-subline">${escapedLegsSummary}</p>
              <div class="bet-tags">
                <span class="bet-tag">${escapedTypeLabel}</span>
                <span class="bet-tag">${escapedScenarioLabel}</span>
                <span class="bet-tag muted">${escapedExtractionLabel}</span>
              </div>
            </div>
          </td>
          <td class="col-selection">${selectionText}</td>
          <td class="col-placed">${formatDateTime(bet.placedAt)}</td>
          <td><span class="pill">${siteLabel}</span></td>
          <td>${gamesCount || '-'}</td>
          <td class="num">${formatCurrency(bet.stake)}</td>
          <td class="num">${Number(bet.odds).toFixed(2)}</td>
          <td class="col-payout num">${formatCurrency(payout)}</td>
          <td class="col-profit num">${formatCurrency(bet.profit)}</td>
          <td class="num ${settled > 0 ? 'pos' : settled < 0 ? 'neg' : 'neu'}">${formatSignedCurrency(settled)}</td>
          <td class="col-confidence num">${Number(bet.confidenceScore || 0).toFixed(2)}</td>
          <td>
            <select class="status-select status-${bet.status}" data-id="${bet.id}">
              <option value="pending" ${bet.status === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="won" ${bet.status === 'won' ? 'selected' : ''}>Won</option>
              <option value="lost" ${bet.status === 'lost' ? 'selected' : ''}>Lost</option>
            </select>
          </td>
          <td>
            ${bet.screenshot ? `<a href="${bet.screenshot}" target="_blank" rel="noopener noreferrer">View</a>` : '-'}
          </td>
          <td><button type="button" class="delete-bet action-btn" data-id="${bet.id}" aria-label="Delete bet ${bet.id}">Delete</button></td>
        </tr>
      `;
      }
    )
    .join('');
}

function applyHistoryColumnVisibility() {
  for (const input of historyColumnToggles) {
    if (!(input instanceof HTMLInputElement)) {
      continue;
    }

    const key = input.dataset.historyCol;
    if (!key) {
      continue;
    }

    const isVisible = input.checked;
    document.querySelectorAll(`.col-${key}`).forEach((cell) => {
      if (!(cell instanceof HTMLElement)) {
        return;
      }
      cell.style.display = isVisible ? '' : 'none';
    });
  }
}

function applyHistoryDensity() {
  if (!historyTableWrap || !historyDensity) {
    return;
  }

  historyTableWrap.classList.toggle('density-comfortable', historyDensity.value === 'comfortable');
}

function refreshHistoryPanel() {
  const filtered = getFilteredBets();
  renderBets(filtered);
  applyHistoryColumnVisibility();
  applyHistoryDensity();
  renderHistorySummary(filtered.length, allBets.length);
  renderStats(computeStatsFromBets(filtered));
}

async function refreshData() {
  const betsResponse = await fetch('/api/bets');

  if (!betsResponse.ok) {
    throw new Error('Failed to load data from server');
  }

  const betsPayload = await betsResponse.json();
  allBets = betsPayload.bets || [];
  buildSiteFilterOptions(allBets);
  refreshHistoryPanel();
}

async function updateBetStatus(id, status) {
  const response = await fetch(`/api/bets/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Could not update bet status');
  }
}

async function deleteBetById(id) {
  const response = await fetch(`/api/bets/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Could not delete bet');
  }
}

async function runBatchUpload() {
  if (!batchInput || !batchInput.files?.length) {
    throw new Error('Choose one or more screenshots for batch upload');
  }

  const data = new FormData();
  for (const file of batchInput.files) {
    data.append('screenshots', file);
  }

  const response = await fetch('/api/bets/upload/batch', {
    method: 'POST',
    body: data
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Batch upload failed');
  }

  return response.json();
}

if (form && list) {
  if (pasteButton && pasteTarget) {
    pasteButton.addEventListener('click', () => {
      pasteTarget.focus();
      pasteTarget.select();
      setMessage('Paste your screenshot now.');
    });

    pasteTarget.addEventListener('paste', handlePasteEvent);
    form.addEventListener('paste', handlePasteEvent);
  }

  batchUploadButton?.addEventListener('click', async () => {
    try {
      setMessage('Running batch upload...');
      const payload = await runBatchUpload();
      const filesProcessed = Number(payload.filesProcessed || 0);
      const extractedCount = Number(payload.extractedCount || 0);
      setMessage(`Batch complete: ${extractedCount} bets from ${filesProcessed} screenshots.`);
      if (batchInput) {
        batchInput.value = '';
      }
      await refreshData();
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      setMessage('Uploading...');
      const data = new FormData(form);

      const response = await fetch('/api/bets/upload', {
        method: 'POST',
        body: data
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Upload failed');
      }

      const payload = await response.json();
      const extractedCount = Number(payload.extractedCount || 1);
      const site = payload.detectedBookmaker || 'unknown-site';

      form.reset();
      setMessage(`Imported ${extractedCount} bet${extractedCount > 1 ? 's' : ''} from ${site}.`);
      await refreshData();
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  list.addEventListener('change', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !target.classList.contains('status-select')) {
      return;
    }

    const id = Number(target.dataset.id);
    const status = target.value;

    try {
      await updateBetStatus(id, status);
      await refreshData();
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  list.addEventListener('click', async (event) => {
    const target = event.target;

    if (target instanceof HTMLButtonElement && target.classList.contains('bet-expand')) {
      setMessage(target.title || target.textContent || 'Bet details not available.');
      return;
    }

    if (!(target instanceof HTMLButtonElement) || !target.classList.contains('delete-bet')) {
      return;
    }

    const id = Number(target.dataset.id);
    if (!Number.isInteger(id) || id <= 0) {
      return;
    }

    try {
      await deleteBetById(id);
      setMessage('Bet deleted.');
      await refreshData();
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  const historyControlHandler = () => {
    refreshHistoryPanel();
  };

  historySearch?.addEventListener('input', historyControlHandler);
  historyStatusFilter?.addEventListener('change', historyControlHandler);
  historySiteFilter?.addEventListener('change', historyControlHandler);
  historyDensity?.addEventListener('change', applyHistoryDensity);
  historyColumnToggles.forEach((input) => {
    input.addEventListener('change', applyHistoryColumnVisibility);
  });

  refreshData().catch((error) => {
    setMessage(error.message, true);
  });
}

if (typeof module !== 'undefined') {
  module.exports = { createBetLine, formatCurrency };
}
