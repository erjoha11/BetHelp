const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const {
  addBet,
  computeStats,
  listBets,
  updateBetStatus,
  validateStatus
} = require('./lib/betStore');
const { extractBetFromScreenshot } = require('./lib/ocrParser');

const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');
const port = process.env.PORT || 3000;

function getSafePath(urlPath) {
  const pathnameRaw = String(urlPath || '/').split('?')[0];
  let pathname;

  try {
    pathname = decodeURIComponent(pathnameRaw);
  } catch {
    return null;
  }

  const pathSegments = pathname.split('/');

  if (pathSegments.includes('..')) {
    return null;
  }

  const normalized = path.posix.normalize(pathname);
  return normalized === '/' ? '/index.html' : normalized;
}

fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, uploadsDir);
  },
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if ((file.mimetype || '').startsWith('image/')) {
      callback(null, true);
      return;
    }

    callback(new Error('Only image uploads are allowed'));
  }
});

const app = express();
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(publicDir));

app.get('/api/bets', (_req, res) => {
  res.json({ bets: listBets() });
});

app.get('/api/stats', (_req, res) => {
  res.json({ stats: computeStats() });
});

app.post('/api/bets', (req, res) => {
  try {
    const bet = addBet({
      name: req.body?.name,
      stake: req.body?.stake,
      odds: req.body?.odds,
      placedAt: req.body?.placedAt,
      source: 'manual'
    });

    res.status(201).json({ bet });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/bets/upload', upload.single('screenshot'), (req, res) => {
  Promise.resolve()
    .then(async () => {
    if (!req.file) {
      res.status(400).json({ error: 'Screenshot file is required' });
      return;
    }

      const parsed = await extractBetFromScreenshot(req.file.path);

    const bet = addBet({
        name: parsed.name,
        stake: parsed.stake,
        odds: parsed.odds,
      placedAt: req.body?.placedAt,
      source: 'screenshot',
        extractionStatus: parsed.extractionStatus,
      screenshot: `/uploads/${req.file.filename}`
    });

    res.status(201).json({ bet });
    })
    .catch((error) => {
      if (req.file?.path) {
        fs.unlinkSync(req.file.path);
      }

      res.status(400).json({ error: error.message });
    });
});

app.patch('/api/bets/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const status = req.body?.status;

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid bet id' });
    return;
  }

  if (!validateStatus(status)) {
    res.status(400).json({ error: 'Status must be pending, won, or lost' });
    return;
  }

  const updated = updateBetStatus(id, status);
  if (!updated) {
    res.status(404).json({ error: 'Bet not found' });
    return;
  }

  res.json({ bet: updated });
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error.message === 'Only image uploads are allowed') {
    res.status(400).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: 'Unexpected server error' });
});

const server = http.createServer(app);

if (require.main === module) {
  server.listen(port, () => {
    console.log(`BetHelp app is running at http://localhost:${port}`);
  });
}

module.exports = { app, server, getSafePath };
