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

let allBets = [];

const formatCurrency = (value) => `${value.toFixed(2)} Kr`;

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
      '<tr><td colspan="7" class="empty">No matching bets. Try changing filters or upload a new screenshot.</td></tr>';
    return;
  }

  list.innerHTML = bets
    .map(
      (bet) => {
        const legs = Array.isArray(bet.legs) ? bet.legs : [];
        const legsMarkup = legs.length
          ? `<ul class="legs-list">${legs
              .map(
                (leg) =>
                  `<li>${leg.homeTeam} vs ${leg.awayTeam}</li>`
              )
              .join('')}</ul>`
          : '';

        return `
        <tr>
          <td>
            <strong>${bet.name}</strong>
            <div class="meta">${formatDateTime(bet.placedAt)}</div>
            <div class="meta">Site: ${bet.bookmaker || 'unknown-site'}</div>
            <div class="meta">Scenario: ${bet.scenario || 'unknown'}</div>
            <div class="meta">Type: ${bet.betType || 'single'}${legs.length ? ` (${legs.length} games)` : ''}</div>
            <div class="meta">Extraction: ${bet.extractionStatus || 'unknown'}</div>
            <div class="meta">Confidence: ${Number(bet.confidenceScore || 0).toFixed(2)}</div>
            ${legsMarkup}
          </td>
          <td>${formatCurrency(bet.stake)}</td>
          <td>${Number(bet.odds).toFixed(2)}</td>
          <td>${formatCurrency(bet.profit)}</td>
          <td>
            <select class="status-select" data-id="${bet.id}">
              <option value="pending" ${bet.status === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="won" ${bet.status === 'won' ? 'selected' : ''}>Won</option>
              <option value="lost" ${bet.status === 'lost' ? 'selected' : ''}>Lost</option>
            </select>
          </td>
          <td>
            ${bet.screenshot ? `<a href="${bet.screenshot}" target="_blank" rel="noopener noreferrer">View</a>` : '-'}
          </td>
          <td>
            <button type="button" class="danger delete-bet" data-id="${bet.id}">Delete</button>
          </td>
        </tr>
      `;
      }
    )
    .join('');
}

function refreshHistoryPanel() {
  const filtered = getFilteredBets();
  renderBets(filtered);
  renderHistorySummary(filtered.length, allBets.length);
}

async function refreshData() {
  const [betsResponse, statsResponse] = await Promise.all([
    fetch('/api/bets'),
    fetch('/api/stats')
  ]);

  if (!betsResponse.ok || !statsResponse.ok) {
    throw new Error('Failed to load data from server');
  }

  const betsPayload = await betsResponse.json();
  const statsPayload = await statsResponse.json();
  allBets = betsPayload.bets || [];
  buildSiteFilterOptions(allBets);
  refreshHistoryPanel();
  renderStats(statsPayload.stats || {});
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

  refreshData().catch((error) => {
    setMessage(error.message, true);
  });
}

if (typeof module !== 'undefined') {
  module.exports = { createBetLine, formatCurrency };
}
