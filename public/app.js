const form = typeof document !== 'undefined' ? document.getElementById('upload-form') : null;
const list = typeof document !== 'undefined' ? document.getElementById('bet-list') : null;
const statsGrid = typeof document !== 'undefined' ? document.getElementById('stats-grid') : null;
const formMessage = typeof document !== 'undefined' ? document.getElementById('form-message') : null;
const screenshotInput = typeof document !== 'undefined' ? document.getElementById('screenshot') : null;
const pasteButton = typeof document !== 'undefined' ? document.getElementById('paste-button') : null;
const pasteTarget = typeof document !== 'undefined' ? document.getElementById('paste-target') : null;

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
      '<tr><td colspan="6" class="empty">No bets yet. Upload your first screenshot to begin.</td></tr>';
    return;
  }

  list.innerHTML = bets
    .map(
      (bet) => `
        <tr>
          <td>
            <strong>${bet.name}</strong>
            <div class="meta">${formatDateTime(bet.placedAt)}</div>
            <div class="meta">Extraction: ${bet.extractionStatus || 'unknown'}</div>
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
        </tr>
      `
    )
    .join('');
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
  renderBets(betsPayload.bets || []);
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

      form.reset();
      setMessage('Bet imported from screenshot.');
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

  refreshData().catch((error) => {
    setMessage(error.message, true);
  });
}

if (typeof module !== 'undefined') {
  module.exports = { createBetLine, formatCurrency };
}
