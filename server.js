const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const {
  addBet,
  computeStats,
  deleteBet,
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

app.get('/desktop', (_req, res) => {
  res.sendFile(path.join(publicDir, 'desktop.html'));
});

function createBetsFromParsedScreenshot(fileName, parsed, placedAt) {
  const extractedBets = Array.isArray(parsed.bets) && parsed.bets.length ? parsed.bets : [parsed];
  return extractedBets.map((entry) =>
    addBet({
      name: entry.name,
      stake: entry.stake,
      odds: entry.odds,
      status: entry.status,
      confidenceScore: entry.confidenceScore,
      legs: entry.legs,
      betType: entry.betType,
      bookmaker: entry.bookmaker || parsed.bookmaker,
      scenario: entry.scenario,
      placedAt,
      source: 'screenshot',
      extractionStatus: entry.extractionStatus,
      screenshot: `/uploads/${fileName}`
    })
  );
}

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
      const createdBets = createBetsFromParsedScreenshot(
        req.file.filename,
        parsed,
        req.body?.placedAt
      );

      res.status(201).json({
        bets: createdBets,
        detectedBookmaker: parsed.bookmaker,
        extractedCount: createdBets.length
      });
    })
    .catch((error) => {
      if (req.file?.path) {
        fs.unlinkSync(req.file.path);
      }

      res.status(400).json({ error: error.message });
    });
});

app.post('/api/bets/upload/batch', upload.array('screenshots', 25), (req, res) => {
  Promise.resolve()
    .then(async () => {
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) {
        res.status(400).json({ error: 'At least one screenshot is required' });
        return;
      }

      const createdBets = [];
      const fileSummaries = [];

      for (const file of files) {
        const parsed = await extractBetFromScreenshot(file.path);
        const createdForFile = createBetsFromParsedScreenshot(
          file.filename,
          parsed,
          req.body?.placedAt
        );
        createdBets.push(...createdForFile);
        fileSummaries.push({
          fileName: file.originalname,
          storedAs: file.filename,
          bookmaker: parsed.bookmaker || 'unknown-site',
          extractedCount: createdForFile.length
        });
      }

      res.status(201).json({
        bets: createdBets,
        extractedCount: createdBets.length,
        filesProcessed: files.length,
        files: fileSummaries
      });
    })
    .catch((error) => {
      const files = Array.isArray(req.files) ? req.files : [];
      for (const file of files) {
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
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

app.delete('/api/bets/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid bet id' });
    return;
  }

  const deleted = deleteBet(id);
  if (!deleted) {
    res.status(404).json({ error: 'Bet not found' });
    return;
  }

  res.json({ deletedId: id });
});

app.post('/api/bets/reprocess', (req, res) => {
  Promise.resolve()
    .then(async () => {
      const allBets = listBets();
      const requested = Array.isArray(req.body?.screenshots)
        ? req.body.screenshots.map((value) => String(value || '').trim()).filter(Boolean)
        : [];

      const uniqueScreenshots = requested.length
        ? requested
        : Array.from(
            new Set(
              allBets
                .filter((bet) => bet.source === 'screenshot' && bet.screenshot)
                .map((bet) => bet.screenshot)
            )
          );

      const summary = [];

      for (const screenshotPath of uniqueScreenshots) {
        const relative = screenshotPath.replace(/^\//, '');
        const fullPath = path.join(__dirname, relative);

        if (!fs.existsSync(fullPath)) {
          summary.push({ screenshot: screenshotPath, skipped: true, reason: 'file-not-found' });
          continue;
        }

        const existing = listBets().filter((bet) => bet.screenshot === screenshotPath);
        for (const bet of existing) {
          deleteBet(bet.id);
        }

        const parsed = await extractBetFromScreenshot(fullPath);
        const created = createBetsFromParsedScreenshot(path.basename(fullPath), parsed);

        summary.push({
          screenshot: screenshotPath,
          deletedCount: existing.length,
          createdCount: created.length,
          bookmaker: parsed.bookmaker || 'unknown-site'
        });
      }

      res.json({ reprocessed: summary.length, summary });
    })
    .catch((error) => {
      res.status(400).json({ error: error.message });
    });
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
