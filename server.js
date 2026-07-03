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
const configuredApiKey = String(process.env.BETHELP_API_KEY || '').trim();
const writeRateLimitWindowMs = Math.max(
  1000,
  Number(process.env.BETHELP_WRITE_RATE_WINDOW_MS || 60_000)
);
const writeRateLimitMax = Math.max(
  1,
  Number(process.env.BETHELP_WRITE_RATE_MAX || 60)
);
const writeRateBuckets = new Map();

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

function getClientIdentifier(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

function requireApiKey(req, res, next) {
  if (!configuredApiKey) {
    next();
    return;
  }

  const provided = String(req.get('x-api-key') || '').trim();
  if (provided && provided === configuredApiKey) {
    next();
    return;
  }

  res.status(401).json({ error: 'Missing or invalid API key' });
}

function limitWriteRequests(req, res, next) {
  const now = Date.now();
  const key = getClientIdentifier(req);
  const existing = writeRateBuckets.get(key) || [];
  const recent = existing.filter((timestamp) => now - timestamp < writeRateLimitWindowMs);

  if (recent.length >= writeRateLimitMax) {
    res.status(429).json({ error: 'Too many write requests, please retry shortly' });
    return;
  }

  recent.push(now);
  writeRateBuckets.set(key, recent);
  next();
}

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
      selection: entry.selection,
      marketText: entry.marketText,
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

function buildBetInputsFromParsedScreenshot(fileName, parsed, placedAt) {
  const extractedBets = Array.isArray(parsed.bets) && parsed.bets.length ? parsed.bets : [parsed];

  return extractedBets.map((entry) => ({
    name: entry.name,
    selection: entry.selection,
    marketText: entry.marketText,
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
  }));
}

app.get('/api/bets', (_req, res) => {
  res.json({ bets: listBets() });
});

app.get('/api/stats', (_req, res) => {
  res.json({ stats: computeStats() });
});

app.post('/api/bets', requireApiKey, limitWriteRequests, (req, res) => {
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

app.post('/api/bets/upload', requireApiKey, limitWriteRequests, upload.single('screenshot'), (req, res) => {
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

app.post(
  '/api/bets/upload/batch',
  requireApiKey,
  limitWriteRequests,
  upload.array('screenshots', 25),
  (req, res) => {
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
  }
);

app.patch('/api/bets/:id/status', requireApiKey, limitWriteRequests, (req, res) => {
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

app.delete('/api/bets/:id', requireApiKey, limitWriteRequests, (req, res) => {
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

app.post('/api/bets/reprocess', requireApiKey, limitWriteRequests, (req, res) => {
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

        try {
          const parsed = await extractBetFromScreenshot(fullPath);
          const createdInputs = buildBetInputsFromParsedScreenshot(path.basename(fullPath), parsed);

          for (const bet of existing) {
            deleteBet(bet.id);
          }

          const created = createdInputs.map((input) => addBet(input));

          summary.push({
            screenshot: screenshotPath,
            deletedCount: existing.length,
            createdCount: created.length,
            bookmaker: parsed.bookmaker || 'unknown-site'
          });
        } catch (error) {
          summary.push({
            screenshot: screenshotPath,
            skipped: true,
            reason: 'parse-failed',
            error: error.message
          });
        }
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
  const requestedPort = Number(port) || 3000;

  function startServer(preferredPort, allowFallback = true) {
    const onListening = () => {
      const defaultMessage = 'BetHelp app is running at http://localhost:3000';
      if (preferredPort === 3000) {
        console.log(defaultMessage);
        return;
      }

      console.log(`${defaultMessage} (fallback active: http://localhost:${preferredPort})`);
    };

    server.once('listening', onListening);

    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' && allowFallback) {
        server.removeListener('listening', onListening);
        const nextPort = preferredPort + 1;
        console.warn(
          `Port ${preferredPort} is already in use. Retrying on port ${nextPort}...`
        );
        startServer(nextPort, false);
        return;
      }

      throw error;
    });

    server.listen(preferredPort);
  }

  startServer(requestedPort, true);
}

module.exports = { app, server, getSafePath };
