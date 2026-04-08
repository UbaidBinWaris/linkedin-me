'use strict';
/**
 * find_connect.js — LinkedIn My Connections Scraper  (v4)
 *
 * Root cause of previous versions only finding 20 connections:
 *   - `window.scrollBy()` inside page.evaluate() does NOT trigger
 *     LinkedIn's lazy-loader / virtual scroll IntersectionObserver.
 *   - The "Show more" button was being clicked but it kept resetting
 *     the list back to the same first 20 items (bot-detection reset).
 *
 * Fix:
 *   - Use `page.mouse.wheel(0, deltaY)` — this sends a real OS-level
 *     scroll event that properly triggers LinkedIn's virtual scroll.
 *   - No button clicks at all.
 *   - Scrape after every wheel step; new cards appear as you scroll.
 *   - Append each new connection to CSV immediately.
 *
 * Usage:  node find_connect.js
 * Output: ./data/my_connections_<timestamp>.csv
 */

require('dotenv').config();
const chalk    = require('chalk');
const readline = require('readline');
const path     = require('path');
const fs       = require('fs');

const { createSession } = require('./src/browser/session');

// ─────────────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────────────

const OUTPUT_DIR      = path.resolve('./data');
const TIMESTAMP       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUTPUT_CSV_PATH = path.join(OUTPUT_DIR, `my_connections_${TIMESTAMP}.csv`);
const CONNECTIONS_URL = 'https://www.linkedin.com/mynetwork/invite-connect/connections/';

// Mouse wheel delta per scroll step (px).  Smaller = more scrapes, slower.
// LinkedIn loads ~20 cards per "viewport", so 600px catches each batch.
const WHEEL_DELTA_Y  = 800;
// Wait after each wheel event for lazy-loaded cards to render (ms)
const AFTER_WHEEL_MS = 1800;
// Max consecutive scroll steps with zero new connections before giving up
const MAX_STALL      = 12;
// Safety cap on total scroll steps (2000 * 800 = 1.6M px — plenty for 1400+)
const MAX_STEPS      = 2000;

// ─────────────────────────────────────────────────────────────────
//  LOGGER
// ─────────────────────────────────────────────────────────────────

const log     = (msg) => console.log(chalk.cyan('[SCRAPER] ') + msg);
const success = (msg) => console.log(chalk.green('[✓] ')      + msg);
const warn    = (msg) => console.log(chalk.yellow('[!] ')     + msg);
const info    = (msg) => console.log(chalk.blue('[INFO] ')    + msg);

function logStep(n, label) {
  console.log('');
  console.log(chalk.bold.magenta(`── Step ${n}: ${label} ──`));
}

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.bold.yellow(prompt), () => { rl.close(); resolve(); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────
//  CSV
// ─────────────────────────────────────────────────────────────────

const CSV_HEADER = 'name,username,profileUrl,headline,location,mutualConnections,connectedOn\n';

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function initCsv() {
  fs.writeFileSync(OUTPUT_CSV_PATH, CSV_HEADER, 'utf-8');
}

function esc(v) {
  return `"${(v == null ? '' : String(v)).replace(/"/g, '""')}"`;
}

function appendRow(c) {
  const row = [esc(c.name), esc(c.username), esc(c.profileUrl),
               esc(c.headline), esc(c.location),
               esc(c.mutualConnections), esc(c.connectedOn)].join(',') + '\n';
  fs.appendFileSync(OUTPUT_CSV_PATH, row, 'utf-8');
}

// ─────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────

function extractUsername(url) {
  const m = (url || '').match(/linkedin\.com\/in\/([^/?#]+)/);
  return m ? m[1] : '';
}

// ─────────────────────────────────────────────────────────────────
//  MOUSE-WHEEL SCROLL
//  page.mouse.wheel() generates a real WheelEvent — this is the key
//  difference from window.scrollBy() which LinkedIn's observer ignores.
// ─────────────────────────────────────────────────────────────────

async function wheelScroll(page, deltaY) {
  if (page.isClosed()) return;
  try {
    // Move mouse to centre of page first so the wheel hits the right element
    const vp = page.viewportSize() || { width: 1366, height: 768 };
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await page.mouse.wheel(0, deltaY);
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────
//  SCRAPE VISIBLE CARDS
// ─────────────────────────────────────────────────────────────────

async function scrapeVisible(page) {
  if (page.isClosed()) return [];
  try {
    return await page.evaluate(() => {
      const results  = [];
      const seenHere = new Set();

      const NOISE = new Set([
        'Connect','Follow','Message','Withdraw','Pending',
        'Remove','Ignore','Accept','More','Block or Report',
      ]);
      const isDeg    = (s) => /^•?\s*(1st|2nd|3rd\+)/i.test(s);
      const isMutual = (s) => /mutual connection/i.test(s);
      const bad      = (s) => NOISE.has(s.trim()) || s.trim().length < 2;

      for (const link of document.querySelectorAll('a[href*="/in/"]')) {
        if (link.closest('nav,header,[role="navigation"]')) continue;

        const href = link.href.split('?')[0].replace(/\/+$/, '');
        if (!href.includes('/in/') || seenHere.has(href)) continue;
        seenHere.add(href);

        // ── find card container ────────────────────────────────
        let card = null;
        let el   = link.parentElement;
        for (let d = 0; d < 25 && el && el.tagName !== 'BODY'; d++) {
          if (el.tagName === 'LI') {
            const fi = el.querySelector('a[href*="/in/"]');
            const fh = fi ? fi.href.split('?')[0].replace(/\/+$/, '') : '';
            if (fh === href) card = el;
            break;
          }
          el = el.parentElement;
        }
        if (!card) {
          let w = link.parentElement;
          for (let d = 0; d < 18 && w && w.tagName !== 'BODY'; d++) {
            const fi = w.querySelector('a[href*="/in/"]');
            const fh = fi ? fi.href.split('?')[0].replace(/\/+$/, '') : '';
            if (fh === href && (w.innerText || '').trim().length > 30) { card = w; break; }
            w = w.parentElement;
          }
        }
        if (!card) continue;

        // ── parse text ────────────────────────────────────────
        const raw  = (card.innerText || '').trim();
        if (raw.length < 5) continue;
        const lines = raw.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);

        let name = '';
        for (const l of lines) {
          if (!bad(l) && !isDeg(l) && !isMutual(l) && l.length > 1) { name = l; break; }
        }
        if (!name || name.length < 2 || name.length > 90) continue;
        if (/^\d/.test(name) || /\bmutual\b/i.test(name)) continue;
        const UI = new Set(['home','my network','jobs','messaging','notifications','me']);
        if (UI.has(name.toLowerCase())) continue;

        let headline = '', passedName = false;
        for (const l of lines) {
          if (bad(l) || isDeg(l) || isMutual(l)) continue;
          if (!passedName) { passedName = true; continue; }
          headline = l; break;
        }

        let location = '', passedHL = !headline;
        for (const l of lines) {
          if (bad(l) || isDeg(l) || isMutual(l)) continue;
          if (l === name || l === headline) { if (l === headline) passedHL = true; continue; }
          if (!passedHL) continue;
          if (l.length > 70 || l.includes('|') || l.includes('@')) continue;
          location = l; break;
        }

        const ml    = lines.find(l => isMutual(l)) || '';
        const mm    = ml.match(/(\d+)\s+mutual/i);
        const mutual = mm ? mm[1] : '0';

        let connectedOn = '';
        for (const l of lines) {
          if (/^connected/i.test(l)) { connectedOn = l.replace(/^connected\s*/i,'').trim(); break; }
        }

        results.push({ name, profileUrl: href, headline, location,
                       mutualConnections: mutual, connectedOn });
      }
      return results;
    });
  } catch (e) {
    if (e.message && e.message.includes('closed')) return [];
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────
//  MAIN SCROLL → SCRAPE → APPEND LOOP
// ─────────────────────────────────────────────────────────────────

async function runScraper(page) {
  const seen   = new Set();   // all profileUrls saved so far
  let total    = 0;
  let stall    = 0;
  let step     = 0;

  const saveNew = (batch) => {
    let n = 0;
    for (const c of batch) {
      if (!seen.has(c.profileUrl)) {
        seen.add(c.profileUrl);
        c.username = extractUsername(c.profileUrl);
        appendRow(c);
        total++;
        n++;
      }
    }
    return n;
  };

  // ── Initial scrape before any scrolling ──
  const init = await scrapeVisible(page);
  const initNew = saveNew(init);
  if (initNew > 0) success(`Initial batch: ${initNew} connection(s) saved.`);

  // ── Scroll loop ──
  while (step < MAX_STEPS && stall < MAX_STALL) {
    if (page.isClosed()) { warn('Page closed — stopping.'); break; }

    step++;
    await wheelScroll(page, WHEEL_DELTA_Y);
    await sleep(AFTER_WHEEL_MS);

    if (page.isClosed()) break;

    const batch  = await scrapeVisible(page);
    const newCnt = saveNew(batch);

    if (newCnt > 0) {
      success(`  step ${step} → +${newCnt} new (total: ${total})`);
      stall = 0;
    } else {
      stall++;
      if (stall % 3 === 0) {
        info(`  step ${step} — no new connections for ${stall} scroll(s). (${total} total)`);
      }
    }

    // Every 50 steps, log a progress summary
    if (step % 50 === 0) {
      log(`  [Progress] step ${step} | total saved: ${total} | stall: ${stall}/${MAX_STALL}`);
    }
  }

  if (stall >= MAX_STALL) {
    info(`Reached stall limit (${MAX_STALL} consecutive scrolls with no new data).`);
    info('All connections have been loaded.');
  } else if (step >= MAX_STEPS) {
    warn(`Hit step limit (${MAX_STEPS}). Increase MAX_STEPS if you have more connections.`);
  }

  return total;
}

// ─────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log(chalk.bold.white('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.white('  🔗  LinkedIn Connections Scraper  (v4)'));
  console.log(chalk.bold.white('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(`  Started : ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} (PKT)`);
  console.log(`  Output  : ${OUTPUT_CSV_PATH}`);
  console.log('');

  logStep(1, 'Preparing CSV file');
  ensureOutputDir();
  initCsv();
  success(`CSV initialised: ${OUTPUT_CSV_PATH}`);

  logStep(2, 'Launching browser & restoring session');
  let browser, page;
  try {
    ({ browser, page } = await createSession());
  } catch (e) {
    console.error(chalk.red(`[ERROR] ${e.message}`));
    process.exit(1);
  }

  let total = 0;

  try {
    logStep(3, 'Navigating to connections page');
    await page.goto(CONNECTIONS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(4000);

    if (page.url().includes('/login') || page.url().includes('/authwall')) {
      console.error(chalk.red('[ERROR] Not logged in.'));
      await waitForEnter('\nPress ENTER to close browser...\n');
      await browser.close();
      process.exit(1);
    }
    success(`On connections page: ${page.url()}`);

    // Click somewhere in the middle of the page so wheel events land on the right element
    const vp = page.viewportSize() || { width: 1366, height: 768 };
    await page.mouse.click(vp.width / 2, vp.height / 2).catch(() => {});
    await sleep(500);

    logStep(4, 'Scrolling with mouse.wheel() to scrape all connections');
    log('Using real mouse wheel events — LinkedIn lazy-load will trigger properly.');
    log('Each new connection is written to CSV immediately.\n');

    total = await runScraper(page);

    console.log('');
    console.log(chalk.bold.white('  ════════════════════════════════════════════'));
    console.log(chalk.bold.green(`  ✅  Total connections scraped : ${total}`));
    console.log(chalk.bold.white(`  📄  CSV file                 : ${OUTPUT_CSV_PATH}`));
    console.log(chalk.bold.white('  ════════════════════════════════════════════'));
    console.log('');

    log('Browser is still open. You can inspect the page.');
    await waitForEnter('\nPress ENTER to close and exit...\n');
    await browser.close();
    log('Done! 👋');

  } catch (e) {
    console.error(chalk.red(`\n[ERROR] ${e.message}`));
    console.error(e.stack);
    console.log(chalk.yellow(`\n[!] Partial data (${total} rows) saved to:\n    ${OUTPUT_CSV_PATH}`));
    try { await waitForEnter('\nPress ENTER to close browser...\n'); await browser.close(); } catch {}
    process.exit(1);
  }
}

main();
