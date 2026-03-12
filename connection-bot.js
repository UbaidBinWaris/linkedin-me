'use strict';
/**
 * connection-bot.js — LinkedIn Connection Request Bot
 *
 * Full pipeline:
 *   1.  Load config & display summary
 *   2.  Prepare CSV data file
 *   3.  Launch browser & restore session
 *   4.  Navigate to LinkedIn People Search
 *   5.  Collect & paginate candidate profiles (name, headline, location)
 *   6.  Filter each candidate:
 *         a. Country filter  (targetCountries code-level guard)
 *         b. Role filter     (targetRoles — buyers only)
 *         c. Exclude filters (students, OTW, recruiters, custom words)
 *         d. Dedup           (already in sent_connections.csv)
 *         e. Random skip     (human variance)
 *   7.  Generate personalised AI note  (OpenAI → Gemini → static template)
 *   8.  Send connection request + note
 *   9.  Log to CSV
 *  10.  Human-like inter-request delay
 *  11.  Print summary → press Enter to close
 *
 * Edit connection-config.js to control ALL settings.
 * Set DRY_RUN=true in .env to test without sending real requests.
 */

require('dotenv').config();
const chalk    = require('chalk');
const readline = require('readline');
const path     = require('path');
const fs       = require('fs');

const { createSession }              = require('./src/browser/session');
const { sendConnectionRequest }      = require('./src/linkedin/connector');
const { generateConnectionNote }     = require('./src/ai/connectionNote');
const cfg                            = require('./connection-config');

// ─────────────────────────────────────────────────────────────────
//  LOGGER HELPERS
// ─────────────────────────────────────────────────────────────────

const log     = (msg) => console.log(chalk.cyan('[BOT] ')  + msg);
const success = (msg) => console.log(chalk.green('[✓] ')   + msg);
const warn    = (msg) => console.log(chalk.yellow('[!] ')  + msg);
const skipped = (msg) => console.log(chalk.gray('[SKIP] ') + msg);
const info    = (msg) => console.log(chalk.blue('[INFO] ') + msg);

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

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// ─────────────────────────────────────────────────────────────────
//  CSV HELPERS
// ─────────────────────────────────────────────────────────────────

const CSV_HEADER = 'profileUrl,name,headline,location,noteSent,timestamp\n';

function ensureCsv() {
  const dir = path.dirname(path.resolve(cfg.sentConnectionsPath));
  if (!fs.existsSync(dir))  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(cfg.sentConnectionsPath)) {
    fs.writeFileSync(cfg.sentConnectionsPath, CSV_HEADER, 'utf-8');
    info(`Created ${cfg.sentConnectionsPath}`);
  }
}

function loadSentUrls() {
  try {
    const content = fs.readFileSync(cfg.sentConnectionsPath, 'utf-8');
    const lines   = content.trim().split('\n').slice(1);
    const urls    = new Set();
    for (const line of lines) {
      const col = line.split(',')[0]?.replace(/^"|"$/g, '').trim();
      if (col) urls.add(col.replace(/\/+$/, ''));
    }
    return urls;
  } catch { return new Set(); }
}

function countTodaySent() {
  try {
    const content  = fs.readFileSync(cfg.sentConnectionsPath, 'utf-8');
    const lines    = content.trim().split('\n').slice(1);
    const todayStr = new Date().toISOString().slice(0, 10);
    return lines.filter((l) => l.includes(todayStr)).length;
  } catch { return 0; }
}

function appendSentRow(profileUrl, name, headline, location, note) {
  const ts       = new Date().toISOString();
  const safeNote = (note || '').replace(/"/g, '""');
  const safeLoc  = (location || '').replace(/"/g, '""');
  const row      = `"${profileUrl}","${name}","${headline}","${safeLoc}","${safeNote}","${ts}"\n`;
  fs.appendFileSync(cfg.sentConnectionsPath, row, 'utf-8');
}

// ─────────────────────────────────────────────────────────────────
//  FILTER LOGIC
// ─────────────────────────────────────────────────────────────────

function lc(str) { return (str || '').toLowerCase(); }

/**
 * Country guard — checks if a location string matches any targetCountry.
 * Returns { pass: bool, reason: string }
 */
function countryCheck(location) {
  // If no target countries configured, skip the check entirely
  if (!cfg.targetCountries || cfg.targetCountries.length === 0) {
    return { pass: true, reason: '' };
  }

  // If location is blank, we can't be sure → allow through (URL filter is first line)
  if (!location || location.trim().length === 0) {
    return { pass: true, reason: '' };
  }

  const loc = lc(location);
  const matched = cfg.targetCountries.some((c) => loc.includes(lc(c)));
  if (matched) return { pass: true, reason: '' };
  return { pass: false, reason: `Location "${location}" not in target countries` };
}

/**
 * Full candidate filter. Returns { include: bool, reason: string }
 */
function shouldInclude(name, headline, location, degree) {
  const h = lc(headline);

  // 1st-degree — already connected
  if (cfg.skip1stDegree && (degree.includes('1st') || h.includes('• 1st'))) {
    return { include: false, reason: 'Already connected (1st degree)' };
  }

  // Students / interns
  if (cfg.skipStudents && cfg._studentSignals.some((s) => h.includes(s))) {
    return { include: false, reason: 'Student / intern headline' };
  }

  // Open To Work
  if (cfg.skipOpenToWork && cfg._otwSignals.some((s) => h.includes(s))) {
    return { include: false, reason: 'Open To Work signal' };
  }

  // Recruiters
  if (cfg.skipRecruiters && cfg._recruiterSignals.some((s) => h.includes(s))) {
    return { include: false, reason: 'Recruiter / HR headline' };
  }

  // Custom skip words
  if (cfg.customSkipWords && cfg.customSkipWords.some((s) => h.includes(lc(s)))) {
    const hit = cfg.customSkipWords.find((s) => h.includes(lc(s)));
    return { include: false, reason: `Custom skip: "${hit}"` };
  }

  // Must match at least one targetRole
  if (cfg.targetRoles && cfg.targetRoles.length > 0) {
    const matched = cfg.targetRoles.some((r) => h.includes(lc(r)));
    if (!matched) return { include: false, reason: 'No buyer/decision-maker role in headline' };
  }

  return { include: true, reason: '' };
}

// ─────────────────────────────────────────────────────────────────
//  SEARCH PAGE SCRAPING
// ─────────────────────────────────────────────────────────────────

/**
 * Scroll down the current page gradually so LinkedIn's Intersection-Observer
 * lazy-loader renders each result card before we try to read its text.
 */
async function scrollToLoadResults(page) {
  await page.evaluate(async () => {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    // Scroll in chunks — triggers the IntersectionObserver on each card
    for (let i = 0; i < 10; i++) {
      window.scrollBy(0, 500);
      await delay(500);
    }
    // Scroll back to top so pagination button is still in view later
    window.scrollTo(0, 0);
    await delay(400);
  });
  await sleep(1200);
}

/**
 * Scrape profile cards from the current LinkedIn People Search results page.
 *
 * LinkedIn now uses randomised/obfuscated CSS class names that change with
 * every deploy. Instead of relying on class selectors we:
 *   1. Scroll the page to trigger lazy-loading of all result cards.
 *   2. Anchor on `a[href*="/in/"]` links — these are stable.
 *   3. Walk UP the DOM from each link until we find a container that:
 *        • has exactly ONE unique /in/ URL (= this profile's card boundary)
 *        • has enough text to contain name + headline + location.
 *   4. Parse name / headline / location from the card's innerText lines.
 */
async function scrapeSearchPage(page) {
  await scrollToLoadResults(page);

  // Make sure at least one profile link is visible before evaluating
  try {
    await page.waitForSelector('a[href*="/in/"]', { timeout: 8000 });
  } catch {
    warn('  No profile links found on this page — may be a CAPTCHA / redirect.');
    return [];
  }

  return page.evaluate(() => {
    const results  = [];
    const seenUrls = new Set();

    // UI noise that should never appear as name / headline / location
    const NOISE = new Set([
      'Connect', 'Follow', 'Message', 'Pending', 'Withdraw',
      'Promoted', 'Sponsored', 'LinkedIn Member', '...',
    ]);
    const isDegree = (s) => /^•?\s*(1st|2nd|3rd\+)/i.test(s);
    const isNoise  = (s) => NOISE.has(s) || isDegree(s) || /^\d+$/.test(s) || s.length < 2;

    const allLinks = Array.from(document.querySelectorAll('a[href*="/in/"]'));

    for (const link of allLinks) {
      // Skip nav / header links (user's own profile in the top bar)
      if (link.closest('nav, header, [role="navigation"]')) continue;

      const href = (link.href || '').split('?')[0];
      if (!href.includes('/in/'))       continue;
      if (href.includes('/messaging/')) continue;
      if (href.includes('/jobs/'))      continue;
      if (href.includes('/company/'))   continue;
      if (seenUrls.has(href))           continue;
      seenUrls.add(href);

      // ── Step 1: find the nearest <li> ancestor ──────────────────────
      // LinkedIn renders each search result as a <li>.
      // We validate that the FIRST /in/ link inside that <li> is ours —
      // mutual-connection links appear later in the card markup, not first.
      let card = null;
      let liFound = false;

      let el = link.parentElement;
      for (let d = 0; d < 20 && el && el.tagName !== 'BODY'; d++) {
        if (el.tagName === 'LI') {
          liFound = true;
          const firstIn   = el.querySelector('a[href*="/in/"]');
          const firstHref = firstIn ? firstIn.href.split('?')[0] : '';
          if (firstHref === href) {
            card = el;    // ✓ this li belongs to our profile
          }
          // Either way (match or reject), stop at the first <li>
          break;
        }
        el = el.parentElement;
      }

      // If we found a <li> but it's not ours, this is a mutual-connection
      // link inside someone else's card — skip it entirely.
      if (liFound && !card) continue;

      // ── Step 2: fallback walk-up (only if no <li> found) ───────────
      if (!card) {
        let walker = link.parentElement;
        for (let d = 0; d < 15 && walker && walker.tagName !== 'BODY'; d++) {
          const firstIn   = walker.querySelector('a[href*="/in/"]');
          const firstHref = firstIn ? firstIn.href.split('?')[0] : '';
          const cardLen   = (walker.innerText || '').trim().length;
          if (firstHref === href && cardLen > 50) {
            card = walker;
            // Keep walking up while the first link is still ours
            const parent = walker.parentElement;
            if (parent && parent.tagName !== 'BODY') {
              const pFirst = parent.querySelector('a[href*="/in/"]');
              const pHref  = pFirst ? pFirst.href.split('?')[0] : '';
              if (pHref === href) { walker = parent; continue; }
            }
            break;
          }
          walker = walker.parentElement;
        }
      }

      if (!card) continue;

      // ── Only include cards whose action button is "Connect" ─────────
      // Skip cards that show "Message" (already 1st degree) or
      // "Follow" (creator/public figure) — no Connect link present.
      const hasConnect =
        card.querySelector('a[href*="custom-invite"]') !== null ||
        card.querySelector('a[aria-label*="connect" i]') !== null ||
        card.querySelector('button[aria-label*="connect" i]') !== null;
      if (!hasConnect) continue;

      // ── Parse card text ─────────────────────────────────────────────
      const rawText = (card.innerText || card.textContent || '').trim();
      if (!rawText || rawText.length < 10) continue;


      const allRaw = rawText.split(/[\n\r]+/).map((l) => l.trim());
      const lines  = allRaw.filter((l) => !isNoise(l));

      const name     = lines[0] || '';
      const headline = lines[1] || '';

      // Skip if name looks like a mutual-connections blurb or nav UI text
      // e.g. "Rohail Rathore, Om Kirshana and 2 mutual connections"
      // e.g. "0 notifications", "Home", "Jobs"
      if (!name || name.length < 3 || name.length > 70) continue;
      if (/^\d/.test(name)) continue;                          // starts with a digit
      if (/,/.test(name) || /\bmutual\b/i.test(name)) continue;
      if (/ and \d/i.test(name)) continue;
      // Common LinkedIn nav labels that bleed through
      const UI_LABELS = new Set(['home','my network','jobs','messaging','notifications','search','me','for business']);
      if (UI_LABELS.has(name.toLowerCase())) continue;

      // Location: 3rd non-noise line, skipping connection-count lines
      let location = '';
      for (let i = 2; i < Math.min(lines.length, 8); i++) {
        const ln = lines[i];
        if (/connections?|followers?/i.test(ln)) continue;
        if (ln.length < 3) continue;
        // Skip if line looks like a job title / headline, not a location
        // Locations are short, no pipes, no '@', no job-role keywords
        if (ln.includes('|')) continue;
        if (ln.includes('@')) continue;
        if (ln.length > 65) continue;
        if (/\bat\s+[A-Z]/i.test(ln) && ln.split(' ').length > 4) continue; // "Director at Acme Corp"
        location = ln;
        break;
      }

      // Degree
      const degreeLine = allRaw.find((l) => isDegree(l)) || '';
      const degree     = degreeLine.replace(/^•?\s*/, '').trim();

      // Extract invite URL from the Connect <a> tag in the card
      const connectEl = card.querySelector('a[href*="custom-invite"]') ||
                        card.querySelector('a[aria-label*="Invite" i]');
      const inviteHref = connectEl ? (connectEl.getAttribute('href') || '') : '';
      const inviteUrl  = inviteHref
        ? (inviteHref.startsWith('http') ? inviteHref : 'https://www.linkedin.com' + inviteHref)
        : null;

      results.push({ name, headline, location, profileUrl: href, degree, inviteUrl });
    }

    return results;
  });
}

/**
 * Click the pagination "Next" button.
 * Returns true if navigation to next page succeeded.
 */
async function clickNextPage(page) {
  // Scroll to bottom so the Next button/link is rendered and visible
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1200);

  // LinkedIn 2026: pagination uses <a> tags, not <button> — try both
  const nextSel =
    'button[aria-label="Next"], ' +
    'a[aria-label="Next"], ' +
    'button[aria-label*="next page" i], ' +
    'a[aria-label*="next page" i], ' +
    'li.artdeco-pagination__indicator--number:last-child button, ' +
    'li.artdeco-pagination__indicator--number:last-child a';

  const nextBtn = page.locator(nextSel).first();

  if (!(await nextBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    // Last resort: look for any element containing the text "Next" near the footer
    const textNext = page.locator('button:has-text("Next"), a:has-text("Next")').last();
    if (!(await textNext.isVisible({ timeout: 2000 }).catch(() => false))) return false;
    if (await textNext.isDisabled().catch(() => true)) return false;
    await textNext.click();
    await sleep(3500);
    return true;
  }

  if (await nextBtn.isDisabled().catch(() => true)) return false;

  await nextBtn.click();
  await sleep(3500);
  return true;
}

// ─────────────────────────────────────────────────────────────────
//  COLLECT ALL CANDIDATES
// ─────────────────────────────────────────────────────────────────

async function collectCandidates(page, maxPages) {
  const candidates = [];
  log('Navigating to people search URL...');
  await page.goto(cfg.searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    info(`  Scraping search results page ${pageNum}/${maxPages}...`);
    const pageResults = await scrapeSearchPage(page);
    info(`  Found ${pageResults.length} profile card(s) on page ${pageNum}.`);
    candidates.push(...pageResults);

    if (pageNum < maxPages) {
      const hasNext = await clickNextPage(page);
      if (!hasNext) { info('  No more pages.'); break; }
    }
  }

  return candidates;
}

// ─────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log(chalk.bold.white('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.white('  🤝  LinkedIn Connection Bot  —  AI-Powered Outreach'));
  console.log(chalk.bold.white('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(`  Started: ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} (PKT)`);
  if (cfg.dryRun) {
    console.log(chalk.bgYellow.black('  ⚠  DRY RUN MODE — nothing will actually be sent  '));
  }
  console.log('');

  // ── Step 1: Config summary ─────────────────────────────────────────
  logStep(1, 'Configuration');
  log(`Max per run        : ${cfg.maxConnectionsPerRun}`);
  log(`Daily limit        : ${cfg.dailyLimit}`);
  log(`Search pages       : ${cfg.maxSearchPages}`);
  log(`Target roles       : ${cfg.targetRoles.length} buyer keywords`);
  log(`Target countries   : ${cfg.targetCountries.length > 0 ? cfg.targetCountries.slice(0, 5).join(', ') + '…' : 'ALL (no filter)'}`);
  log(`Exclude students   : ${cfg.skipStudents}`);
  log(`Exclude OTW        : ${cfg.skipOpenToWork}`);
  log(`Exclude recruiters : ${cfg.skipRecruiters}`);
  log(`Send note (AI)     : ${cfg.sendNote}`);
  log(`Random skip        : ${(cfg.skipChance * 100).toFixed(0)}%`);

  // ── Step 2: CSV ────────────────────────────────────────────────────
  logStep(2, 'Preparing data file');
  ensureCsv();
  const sentUrls   = loadSentUrls();
  const todayCount = countTodaySent();
  success(`Loaded ${sentUrls.size} previously sent connection(s) for deduplication.`);
  info(`Connections sent today so far: ${todayCount}/${cfg.dailyLimit}`);

  if (todayCount >= cfg.dailyLimit) {
    warn(`Daily limit of ${cfg.dailyLimit} already reached today. Exiting.`);
    process.exit(0);
  }

  // ── Step 3: Browser ────────────────────────────────────────────────
  logStep(3, 'Launching browser & restoring session');
  let browser, page;
  try {
    ({ browser, page } = await createSession());
  } catch (err) {
    warn(`Browser launch failed: ${err.message}`);
    process.exit(1);
  }

  let connectionsSent    = 0;
  let connectionsSkipped = 0;

  try {
    // ── Step 4 & 5: Collect candidates ──────────────────────────────
    logStep(4, 'Collecting candidate profiles from search results');
    const candidates = await collectCandidates(page, cfg.maxSearchPages);
    success(`Collected ${candidates.length} total candidates.`);

    if (candidates.length === 0) {
      warn('No candidates found. Check your searchUrl in connection-config.js.');
      await waitForEnter('\nPress ENTER to close the browser...\n');
      await browser.close();
      return;
    }

    // ── Step 5: Filter, note, send ───────────────────────────────────
    logStep(5, `Evaluating candidates (limit: ${cfg.maxConnectionsPerRun})`);

    for (const candidate of candidates) {
      // Hard limit guard
      const remaining = Math.min(
        cfg.maxConnectionsPerRun - connectionsSent,
        cfg.dailyLimit           - todayCount - connectionsSent
      );
      if (remaining <= 0) { log('Connection limit reached. Stopping.'); break; }

      const { name, headline, location, profileUrl, degree, inviteUrl } = candidate;
      const normalizedUrl = profileUrl.replace(/\/+$/, '');
      const nameStr       = (name || 'Unknown').slice(0, 28).padEnd(28);

      // ── Dedup ──────────────────────────────────────────────────────
      if (sentUrls.has(normalizedUrl)) {
        skipped(`${nameStr} | Already in CSV`);
        connectionsSkipped++;
        continue;
      }

      // ── Country filter (code-level guard) ─────────────────────────
      const { pass: countryOk, reason: countryReason } = countryCheck(location);
      if (!countryOk) {
        skipped(`${nameStr} | ${countryReason}`);
        connectionsSkipped++;
        continue;
      }

      // ── Role + exclude filters ─────────────────────────────────────
      const { include, reason: filterReason } = shouldInclude(name, headline, location, degree);
      if (!include) {
        skipped(`${nameStr} | ${filterReason}`);
        connectionsSkipped++;
        continue;
      }

      // ── Random skip ────────────────────────────────────────────────
      if (Math.random() < cfg.skipChance) {
        skipped(`${nameStr} | Random skip (human variance)`);
        connectionsSkipped++;
        continue;
      }

      // ── AI Note Generation ─────────────────────────────────────────
      let note = '';
      if (cfg.sendNote) {
        log(`\n🤖 Generating AI note for: ${name}...`);
        note = await generateConnectionNote(name, headline, location, cfg.noteTemplates);
        info(`   Note (${note.length} chars): "${note.slice(0, 80)}…"`);
      }

      // ── Print candidate ────────────────────────────────────────────
      log(`\n🔗 Connecting: ${name}`);
      log(`   Headline : ${(headline || '').slice(0, 60)}`);
      log(`   Location : ${location || '(no location)'}`);
      log(`   URL      : ${profileUrl}`);

      // ── Send ───────────────────────────────────────────────────────
      const result = await sendConnectionRequest(page, profileUrl, note, cfg.dryRun, inviteUrl);

      if (result.sent || (cfg.dryRun && !result.skipped)) {
        if (!cfg.dryRun) {
          appendSentRow(normalizedUrl, name, headline, location, note);
          sentUrls.add(normalizedUrl);
        }
        connectionsSent++;
        success(`   ${cfg.dryRun ? '[DRY RUN] Would send' : 'Sent!'} — total: ${connectionsSent}/${cfg.maxConnectionsPerRun}`);
      } else {
        warn(`   Not sent → ${result.reason}`);
        connectionsSkipped++;
      }

      // ── Return to search page ──────────────────────────────────────
      try {
        if (!page.url().includes('linkedin.com/search')) {
          await page.goto(cfg.searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
          await sleep(2500);
        }
      } catch { /* ignore */ }

      // ── Human-like inter-request delay ─────────────────────────────
      if (connectionsSent < cfg.maxConnectionsPerRun && remaining > 1) {
        const waitMs  = randomBetween(cfg.betweenRequestMinMs, cfg.betweenRequestMaxMs);
        const waitSec = Math.round(waitMs / 1000);
        log(`   Waiting ${waitSec}s before next request...`);
        await sleep(waitMs);
      }
    }

    // ── Step 6: Summary ───────────────────────────────────────────────
    logStep(6, 'Run complete');
    console.log('');
    console.log(chalk.bold.white('  ════════════════════════════════════════════'));
    console.log(chalk.bold.green(`  ✅ Connections sent   : ${connectionsSent}`));
    console.log(chalk.bold.yellow(`  ⏭  Skipped            : ${connectionsSkipped}`));
    console.log(chalk.bold.white(`  📋 CSV log            : ${cfg.sentConnectionsPath}`));
    if (cfg.dryRun) {
      console.log(chalk.bgYellow.black('  ⚠  DRY RUN — nothing was actually sent'));
    }
    console.log(chalk.bold.white('  ════════════════════════════════════════════'));
    console.log('');

    log('Browser is still open. You can browse LinkedIn freely.');
    await waitForEnter('\nPress ENTER to close the browser and exit...\n');
    await browser.close();
    log('Bye! 👋');

  } catch (err) {
    console.error(chalk.red(`\n[ERROR] ${err.message}`));
    console.error(err.stack);
    try {
      await waitForEnter('\nPress ENTER to close the browser and exit...\n');
      await browser.close();
    } catch {}
    process.exit(1);
  }
}

main();
