'use strict';
/**
 * feed.js — LinkedIn feed scraper + post finder
 *
 * Exported functions:
 *   findOneInterestingPost(page, commentedUrls)
 *     → Scrapes the current feed page, applies all filters,
 *       and returns ONE interesting post or null.
 *
 *   scrapeProfilePosts(page, profileUrl, profileName)
 *     → Scrapes a specific LinkedIn profile's recent activity.
 *       (Kept for optional use.)
 */

const { shouldSkip, heuristicInterestScore } = require('./filters');

// ─────────────────────────────────────────────────────────────────
//  DOM HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Scrolls the feed gently to trigger lazy-loaded posts.
 */
async function scrollFeed(page, passes = 6) {
  for (let i = 0; i < passes; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(1500);
}

/**
 * Collects post cards from the current page DOM.
 * Returns an array of { postUrl, postText, authorName, authorHeadline }.
 * Pure DOM scrape — no AI needed.
 */
async function collectPostsFromDom(page) {
  return page.evaluate(() => {
    const results = [];
    const seenUrls = new Set();

    // ── Strategy 1: each feed post lives inside a <div data-urn="..."> ──
    const cards = [
      ...document.querySelectorAll('[data-id]'),
      ...document.querySelectorAll('.feed-shared-update-v2'),
      ...document.querySelectorAll('[data-urn]'),
    ];

    for (const card of cards) {
      // Find a post link
      const anchor = card.querySelector('a[href*="/feed/update/"]')
                  || card.querySelector('a[href*="ugcPost"]');
      if (!anchor) continue;

      const href = anchor.getAttribute('href') || '';
      const url = href.startsWith('http')
        ? href.split('?')[0]
        : 'https://www.linkedin.com' + href.split('?')[0];

      if (seenUrls.has(url) || !url.includes('/feed/update/') && !url.includes('ugcPost')) continue;
      seenUrls.add(url);

      // Author name (LinkedIn puts it in an  aria-label or span near top)
      const authorEl = card.querySelector(
        '.update-components-actor__name span[aria-hidden="true"],' +
        '.feed-shared-actor__name,' +
        '.update-components-actor__title span[aria-hidden="true"]'
      );
      const authorName = (authorEl && authorEl.innerText) ? authorEl.innerText.trim() : '';

      // Author headline
      const headlineEl = card.querySelector(
        '.update-components-actor__description span[aria-hidden="true"],' +
        '.feed-shared-actor__description'
      );
      const authorHeadline = (headlineEl && headlineEl.innerText) ? headlineEl.innerText.trim() : '';

      // Post text (the main body — try the Quill rendered text container)
      const textEl = card.querySelector(
        '.update-components-text,' +
        '.feed-shared-text,' +
        '.feed-shared-update-v2__description'
      );
      const postText = (textEl && textEl.innerText) ? textEl.innerText.trim() : '';

      if (postText.length < 80) continue;
      results.push({ postUrl: url, postText, authorName, authorHeadline });
    }

    // ── Strategy 2: fallback — just find /feed/update/ links and walk up ──
    if (results.length === 0) {
      const allLinks = [...document.querySelectorAll(
        'a[href*="/feed/update/"], a[href*="ugcPost"]'
      )];
      for (const link of allLinks) {
        const href = link.getAttribute('href') || '';
        const url = href.startsWith('http')
          ? href.split('?')[0]
          : 'https://www.linkedin.com' + href.split('?')[0];
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        // Walk up the DOM to find meaningful text in a parent container
        let el = link.parentElement;
        let postText = '';
        for (let i = 0; i < 12 && el; i++) {
          const t = (el.innerText || '').trim();
          if (t.length >= 150 && t.length <= 8000) { postText = t; break; }
          el = el.parentElement;
        }
        if (postText.length < 80) continue;

        const lines = postText.split('\n').filter((l) => l.trim().length > 0);
        const authorName = lines[0] || 'Unknown';
        const authorHeadline = lines[1] || '';
        const bodyText = lines.slice(2).join(' ').trim() || postText;

        results.push({ postUrl: url, postText: bodyText, authorName, authorHeadline });
      }
    }

    return results;
  });
}

// ─────────────────────────────────────────────────────────────────
//  NAVIGATE TO FEED
// ─────────────────────────────────────────────────────────────────

/**
 * Ensures the browser is on the LinkedIn feed.
 * If not, clicks the Home navbar link or navigates directly.
 */
async function ensureOnFeed(page) {
  const currentUrl = page.url();
  if (currentUrl.includes('linkedin.com/feed')) {
    console.log('  ✓ Already on LinkedIn feed.');
    return;
  }

  console.log('  Navigating to feed via Home nav link...');

  // Try clicking the Home icon in the navbar first (more human-like)
  const clicked = await page.evaluate(() => {
    const homeLink = document.querySelector(
      'a[href="/feed/"], a[href="https://www.linkedin.com/feed/"]'
    );
    if (homeLink) { homeLink.click(); return true; }
    return false;
  });

  if (!clicked) {
    // Direct navigation fallback
    await page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  }
  await page.waitForTimeout(3000);
}

// ─────────────────────────────────────────────────────────────────
//  MAIN EXPORT: findOneInterestingPost
// ─────────────────────────────────────────────────────────────────

/**
 * Finds ONE interesting post from the current LinkedIn feed.
 *
 * Steps:
 *   1. Make sure we're on the feed page
 *   2. Scroll to load posts
 *   3. Collect post cards from DOM
 *   4. Apply author filters (OTW / student / job post)
 *   5. Apply heuristic interest score
 *   6. Skip already-commented posts
 *   7. Return the first post that passes all checks
 *
 * @param {import('playwright').Page} page
 * @param {Set<string>} commentedUrls - URLs already commented on (dedup)
 * @returns {{ postUrl, postText, authorName, authorHeadline } | null}
 */
async function findOneInterestingPost(page, commentedUrls = new Set()) {
  await ensureOnFeed(page);

  console.log('  Scrolling feed to load posts...');
  await scrollFeed(page, 6);

  console.log('  Collecting posts from DOM...');
  const posts = await collectPostsFromDom(page);
  console.log(`  Found ${posts.length} raw post(s) on the feed.`);

  if (posts.length === 0) {
    console.log('  ⚠️  No posts detected. Try deleting ./session and re-running.');
    return null;
  }

  // Log what we found (useful for debugging)
  for (const p of posts) {
    console.log(`    • ${(p.authorName || 'Unknown').slice(0, 35).padEnd(35)} | ${p.postText.slice(0, 60).replace(/\n/g, ' ')}...`);
  }

  console.log('\n  🔍 Applying filters...');

  for (const post of posts) {
    const { postUrl, postText, authorName, authorHeadline } = post;

    // ── Filter 1: Skip already-commented posts ──
    if (commentedUrls.has(postUrl)) {
      console.log(`  [SKIP] Already commented → ${authorName}`);
      continue;
    }

    // ── Filter 2: Author must not be OTW / student / job-ad ──
    const { skip, reason } = shouldSkip(authorName, authorHeadline, postText);
    if (skip) {
      console.log(`  [SKIP] ${reason} → ${authorName}`);
      continue;
    }

    // ── Filter 3: Heuristic interest check ──
    const { score, interesting } = heuristicInterestScore(postText);
    if (!interesting) {
      console.log(`  [SKIP] Not interesting enough (score ${score}) → ${authorName}`);
      continue;
    }

    console.log(`\n  ✅ Selected post by ${authorName} (heuristic score: ${score})`);
    return post;
  }

  console.log('  ⚠️  All posts were filtered out. Try scrolling more or changing filter settings.');
  return null;
}

// ─────────────────────────────────────────────────────────────────
//  OPTIONAL: Profile recent-activity scraper (kept for future use)
// ─────────────────────────────────────────────────────────────────

async function scrapeProfilePosts(page, profileUrl, profileName) {
  const posts = [];
  if (!profileUrl || profileUrl.includes('example')) return posts;
  const activityUrl = profileUrl.replace(/\/$/, '') + '/recent-activity/shares/';
  console.log(`  Scraping posts from: ${profileName || profileUrl}`);
  try {
    await page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1000);
    }
    const domPosts = await collectPostsFromDom(page);
    for (const p of domPosts) posts.push({ ...p, authorName: profileName || p.authorName });
    console.log(`  Got ${posts.length} post(s) from ${profileName}`);
  } catch (e) {
    console.log(`  Error scraping ${profileName}: ${e.message}`);
  }
  return posts;
}

module.exports = { findOneInterestingPost, scrapeProfilePosts };
