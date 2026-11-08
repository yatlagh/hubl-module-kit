#!/usr/bin/env node
'use strict';

/*
  Captures docs/preview.png from the local preview build.
  Requires Playwright with Chromium installed (not a project dependency):
    npx playwright install chromium
*/

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'preview', 'dist', 'index.html');
const OUT = path.join(ROOT, 'docs', 'preview.png');

async function main() {
  execFileSync(process.execPath, [path.join(ROOT, 'preview', 'build.js')], { stdio: 'inherit', env: { ...process.env, NO_OPEN: '1' } });

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (err) {
    console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`file://${DIST}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT, fullPage: true });
  await browser.close();
  console.log(`Saved ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
