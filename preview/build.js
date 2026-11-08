#!/usr/bin/env node
'use strict';

/*
  Local preview for the Northwind theme. No HubSpot account needed.

    npm run preview:build   renders src/theme/templates/landing-page.html,
                            css/main.css and every module into preview/dist/
    npm run preview         same, then serves preview/dist/ and opens a browser

  The renderer is a HubL subset on top of Nunjucks; see preview/lib/hubl.js.
*/

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');

const { HublRenderer } = require('./lib/hubl');
const { buildThemeContext, googleFontsUrl } = require('./lib/theme-fields');

const ROOT = path.resolve(__dirname, '..');
const THEME = path.join(ROOT, 'src', 'theme');
const DIST = path.join(__dirname, 'dist');
const SAMPLE = path.join(__dirname, 'sample-data');
const ASSETS = path.join(__dirname, 'assets');

const TEMPLATE = process.env.PREVIEW_TEMPLATE || 'templates/landing-page.html';
const PORT = Number(process.env.PORT) || 4173;

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const themeFields = JSON.parse(fs.readFileSync(path.join(THEME, 'fields.json'), 'utf8'));
  const themeContext = buildThemeContext(themeFields);
  const fontsUrl = googleFontsUrl(themeFields);

  const headerIncludes = [
    '<link rel="stylesheet" href="preview.css">'
  ];
  if (fontsUrl) {
    headerIncludes.unshift(
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      `<link rel="stylesheet" href="${fontsUrl}">`
    );
  }

  const renderer = new HublRenderer({
    themeRoot: THEME,
    sampleDataDir: SAMPLE,
    themeContext,
    headerIncludes
  });

  // 1. Brand stylesheet: HubL in CSS, resolved with theme field values.
  const mainCssSrc = fs.readFileSync(path.join(THEME, 'css', 'main.css'), 'utf8');
  fs.mkdirSync(path.join(DIST, 'css'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'css', 'main.css'), renderer.renderString(mainCssSrc));

  // 2. Static theme assets.
  copy(path.join(THEME, 'js', 'main.js'), path.join(DIST, 'js', 'main.js'));
  for (const dir of fs.readdirSync(path.join(THEME, 'modules'))) {
    const css = path.join(THEME, 'modules', dir, 'module.css');
    if (fs.existsSync(css)) copy(css, path.join(DIST, 'modules', dir, 'module.css'));
  }
  copy(path.join(__dirname, 'preview.css'), path.join(DIST, 'preview.css'));
  if (fs.existsSync(ASSETS)) {
    for (const file of fs.readdirSync(ASSETS)) copy(path.join(ASSETS, file), path.join(DIST, 'assets', file));
  }

  // 3. The page itself.
  const html = renderer.renderTemplate(TEMPLATE);
  fs.writeFileSync(path.join(DIST, 'index.html'), html);

  const modules = [...renderer.usedModules].sort();
  console.log(`Rendered ${TEMPLATE} with ${modules.length} modules (${modules.join(', ')})`);
  console.log(`Output: ${path.relative(ROOT, DIST)}/index.html`);
  return DIST;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json'
};

function serve(dir) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let file = path.normalize(path.join(dir, urlPath === '/' ? 'index.html' : urlPath));
    if (!file.startsWith(dir)) {
      res.writeHead(403); res.end(); return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });

  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}/`;
    console.log(`Preview running at ${url} (Ctrl+C to stop)`);
    openBrowser(url);
  });
}

function openBrowser(url) {
  if (process.env.CI || process.env.NO_OPEN) return;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(cmd, args, () => { /* ignore: no browser available (CI, containers) */ });
}

const dist = build();
if (process.argv.includes('--serve')) serve(dist);
