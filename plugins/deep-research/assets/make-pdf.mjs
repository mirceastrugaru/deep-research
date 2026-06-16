// Render a filled memo-kit HTML to a clean PDF.
//   node make-pdf.mjs <input.html> <output.pdf>
//
// Recipe (each setting fixes a specific failure mode):
//   - A4, printBackground true  -> the cream paper colour and accents render
//   - preferCSSPageSize true     -> the kit's @page margins repeat every page (the kit sets margins,
//     not size; page size falls back to format A4 below)
//   - scale 1.0                  -> do NOT shrink; shrinking makes text small and cramped
//   - margins come from CSS @page, not from here, and NOT from a fixed on-screen card
//     (a tall coloured card on a dark body prints black stripes at page breaks - the kit's
//      @media print block resets the background to paper and drops the card's fixed size)
//
// Playwright resolution: tries the working dir, then common global locations. If none,
// run:  npm i playwright && npx playwright install chromium

import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';

const [,, inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error('usage: node make-pdf.mjs <input.html> <output.pdf>');
  process.exit(1);
}

const require = createRequire(import.meta.url);
function loadChromium() {
  // 0. explicit override: PLAYWRIGHT_PATH=/abs/path/to/node_modules/playwright
  if (process.env.PLAYWRIGHT_PATH) {
    try { return require(process.env.PLAYWRIGHT_PATH).chromium; } catch {}
  }
  // 1. normal resolution (installed in cwd or alongside this script)
  try { return require('playwright').chromium; } catch {}
  try { return require('playwright-core').chromium; } catch {}
  // 2. scan likely installs: cwd, common globals
  const candidates = [
    path.join(process.cwd(), 'node_modules/playwright/index.js'),
    '/usr/local/lib/node_modules/playwright/index.js',
    '/opt/homebrew/lib/node_modules/playwright/index.js',
    `${process.env.HOME}/.npm-global/lib/node_modules/playwright/index.js`,
  ];
  for (const c of candidates) {
    if (existsSync(c)) { return require(c).chromium; }
  }
  throw new Error(
    'playwright not found. Either install it in the working dir\n' +
    '  (npm i playwright && npx playwright install chromium)\n' +
    'or point at an existing install:\n' +
    '  PLAYWRIGHT_PATH=/path/to/node_modules/playwright node make-pdf.mjs in.html out.pdf'
  );
}

const chromium = loadChromium();
const url = pathToFileURL(path.resolve(inFile)).href; // correct on Windows too

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500); // let CDN webfonts settle (400ms is too short on slow links)
await page.pdf({
  path: path.resolve(outFile),
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  scale: 1.0,
});
await browser.close();
console.log('wrote', outFile);
