const form = typeof document !== 'undefined' ? document.getElementById('bet-form') : null;
const list = typeof document !== 'undefined' ? document.getElementById('bet-list') : null;
const photoBatchInput =
  typeof document !== 'undefined' ? document.getElementById('photo-batch-input') : null;
const photoBatchButton =
  typeof document !== 'undefined' ? document.getElementById('photo-batch-button') : null;
const photoBatchMessage =
  typeof document !== 'undefined' ? document.getElementById('photo-batch-message') : null;
const photoBatchList =
  typeof document !== 'undefined' ? document.getElementById('photo-batch-list') : null;

const formatCurrency = (value) => `$${value.toFixed(2)}`;

function createBetLine(name, stake, odds) {
  const payout = stake * odds;
  const profit = payout - stake;
  return `${name}: stake ${formatCurrency(stake)}, odds ${odds.toFixed(2)}, payout ${formatCurrency(payout)}, profit ${formatCurrency(profit)}`;
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function summarizePhotoSelection(files) {
  const imageFiles = (Array.isArray(files) ? files : []).filter((file) =>
    String(file?.type || '').startsWith('image/')
  );

  const totalBytes = imageFiles.reduce((acc, file) => acc + Number(file.size || 0), 0);
  return {
    count: imageFiles.length,
    totalBytes,
    totalSizeLabel: formatFileSize(totalBytes)
  };
}

function renderSelectedPhotos(files) {
  if (!photoBatchList || !photoBatchMessage) {
    return;
  }

  const { count, totalSizeLabel } = summarizePhotoSelection(files);

  if (!count) {
    photoBatchList.innerHTML = '';
    photoBatchMessage.textContent = 'No valid image files selected.';
    return;
  }

  photoBatchMessage.textContent = `${count} photos selected (${totalSizeLabel}).`;
  photoBatchList.innerHTML = files
    .filter((file) => String(file?.type || '').startsWith('image/'))
    .map((file) => `<li>${file.name} (${formatFileSize(file.size)})</li>`)
    .join('');
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

if (photoBatchButton && photoBatchInput) {
  photoBatchButton.addEventListener('click', () => {
    const files = Array.from(photoBatchInput.files || []);
    renderSelectedPhotos(files);
  });

  photoBatchInput.addEventListener('change', () => {
    const files = Array.from(photoBatchInput.files || []);
    renderSelectedPhotos(files);
  });
}

if (typeof module !== 'undefined') {
  module.exports = { createBetLine, summarizePhotoSelection, formatFileSize };
}
