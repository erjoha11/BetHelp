const http = require('http');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');
const port = process.env.PORT || 3000;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8'
};

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

const server = http.createServer((req, res) => {
  const safePath = getSafePath(req.url || '/');
  if (!safePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const filePath = path.resolve(publicDir, `.${safePath}`);
  const relativePath = path.relative(publicDir, filePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain; charset=utf-8' });
    res.end(content);
  });
});

if (require.main === module) {
  server.listen(port, () => {
    console.log(`BetHelp app is running at http://localhost:${port}`);
  });
}

module.exports = { server, getSafePath };
