'use strict';
/**
 * feed.js — LinkedIn feed scraper + post finder
 *
 * Uses FOUR strategies in order, stopping at the first that finds posts:
 *
 *  Strategy A: Link-walk on /posts/ URLs (current LinkedIn format)
 *  Strategy B: Link-walk on /feed/update/ URLs (older format)
 *  Strategy C: data-urn walk (find activity URNs and build URLs)
 *  Strategy D: body.innerText parsing — split by known author patterns,
 *              no URL needed — returns posts even if URL is missing
 *
 * Exported:
 *   findOneInterestingPost(page, commentedUrls) → post | null
 *   scrapeProfilePosts(page, profileUrl, name)  → post[]
 */

const { shouldSkip, heuristicInterestScore } = require('./filters');

// ─────────────────────────────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────────────────────────────

async function ensureOnFeed(page) {
  const url = page.url();
  if (url.includes('linkedin.com/feed')) {
    console.log('  ✓ Already on LinkedIn feed.');
    return;
  }
  console.log('  Navigating to LinkedIn feed...');
  // Try clicking the Home icon first (natural)
  const clicked = await page.evaluate(() => {
    const l = document.querySelector('a[href="/feed/"]') ||
              document.querySelector('a[href="https://www.linkedin.com/feed/"]');
    if (l) { l.click(); return true; }
    return false;
  });
  if (!clicked) {
    await page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
  }
  await page.waitForTimeout(4000);
}

// ─────────────────────────────────────────────────────────────────
//  SCROLL
// ─────────────────────────────────────────────────────────────────

async function scrollFeed(page, passes = 10) {
  console.log(`  Scrolling (${passes} passes)...`);
  for (let i = 0; i < passes; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(900);
  }
  // Scroll back near the top so we see everything
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
}

// ─────────────────────────────────────────────────────────────────
//  STRATEGY A + B — Link walk (multiple URL patterns)
// ─────────────────────────────────────────────────────────────────

async function collectByLinkWalk(page) {
  return page.evaluate(() => {
    const results = [];
    const seenUrls = new Set();

    // All known LinkedIn post URL patterns
    const selectors = [
      // Current format (2024-2025): /posts/username_activity-xxx/
      'a[href*="/posts/"]',
      // Legacy format: /feed/update/urn:li:activity:xxx
      'a[href*="/feed/update/"]',
      // Another pattern used in some regions
      'a[href*="ugcPost"]',
      // Activity URN pattern
      'a[href*="activity"]',
    ];

    const anchors = new Set();
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((a) => anchors.add(a));
    }

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      if (!href) continue;

      // Skip navigation links, profile links, company links etc.
      if (
        href.includes('/company/') ||
        href.includes('/jobs/') ||
        href.includes('/learning/') ||
        href.includes('/messaging/') ||
        href.includes('/notifications/') ||
        href.includes('/mynetwork/') ||
        href === '/feed/' ||
        href === '/'
      ) continue;

      const url = href.startsWith('http')
        ? href.split('?')[0]
        : 'https://www.linkedin.com' + href.split('?')[0];

      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      // Walk UP to find the containing post card with enough text
      let el = anchor.parentElement;
      let postText = '';
      for (let depth = 0; depth < 25 && el && el.tagName !== 'BODY'; depth++) {
        const t = (el.innerText || '').trim();
        // A post card: between 150 and 30000 chars
        if (t.length >= 150 && t.length <= 30000) {
          postText = t;
          break;
        }
        el = el.parentElement;
      }

      if (!postText || postText.length < 80) continue;

      // Parse author and body from the text block
      const lines = postText.split('\n').map((l) => l.trim()).filter(Boolean);

      // Author name heuristic: first short line (≤70 chars, ≤8 words)
      let authorName = 'Unknown';
      let authorHeadline = '';
      let bodyStart = 0;
      for (let i = 0; i < Math.min(lines.length, 12); i++) {
        const ln = lines[i];
        if (ln.length <= 70 && !ln.includes('http')) {
          const wc = ln.split(' ').filter(Boolean).length;
          if (!authorName || authorName === 'Unknown') {
            if (wc >= 1 && wc <= 8) { authorName = ln; bodyStart = i + 1; }
          } else if (!authorHeadline && wc <= 14) {
            authorHeadline = ln; bodyStart = i + 1;
          } else { break; }
        } else { if (authorName !== 'Unknown') break; }
      }

      const body = lines.slice(bodyStart).join(' ').trim();
      if (body.length < 80) continue;

      results.push({ postUrl: url, postText: body, authorName, authorHeadline });
    }
    return results;
  });
}

// ─────────────────────────────────────────────────────────────────
//  STRATEGY C — data-urn walk
//  LinkedIn decorates post containers with data-urn="urn:li:activity:..."
// ─────────────────────────────────────────────────────────────────

async function collectByDataUrn(page) {
  return page.evaluate(() => {
    const results = [];
    const seen = new Set();

    const elements = document.querySelectorAll('[data-urn*="activity"], [data-id*="activity"], [data-entity-urn]');
    for (const el of elements) {
      const urn = el.getAttribute('data-urn') || el.getAttribute('data-id') || el.getAttribute('data-entity-urn') || '';
      if (!urn || seen.has(urn)) continue;
      seen.add(urn);

      // Build a post URL from the URN
      const match = urn.match(/activity[:\-](\d+)/);
      const activityId = match ? match[1] : '';
      const postUrl = activityId
        ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`
        : '';

      if (!postUrl) continue;

      // Extract text from the container
      const text = (el.innerText || '').trim();
      if (text.length < 150) continue;

      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      let authorName = lines[0] || 'Unknown';
      let authorHeadline = lines[1] || '';
      const body = lines.slice(2).join(' ').trim();
      if (body.length < 80) continue;

      results.push({ postUrl, postText: body, authorName, authorHeadline });
    }
    return results;
  });
}

// ─────────────────────────────────────────────────────────────────
//  STRATEGY D — body.innerText parse (URL-free fallback)
//  The most resilient approach — works even with no post links.
//  We split the page text into chunks and treat each as a potential post.
// ─────────────────────────────────────────────────────────────────

async function collectByBodyText(page) {
  const bodyText = await page.evaluate(() => document.body.innerText || '');
  if (bodyText.length < 500) return [];

  const results = [];
  const seen = new Set();

  // Split on blank lines (paragraph boundary)
  const chunks = bodyText.split(/\n{2,}/);

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    // A post body: 120-5000 chars, more than 5 words
    if (trimmed.length < 120 || trimmed.length > 5000) continue;
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount < 10) continue;

    // Skip if it looks like nav / UI chrome
    const lower = trimmed.toLowerCase();
    if (
      lower.startsWith('home') || lower.startsWith('my network') ||
      lower.startsWith('jobs') || lower.startsWith('messaging') ||
      lower.startsWith('notifications') || lower.startsWith('search')
    ) continue;

    const key = trimmed.slice(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);

    // Best-effort author: first line
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    const authorName = lines[0] || 'Unknown';
    const body = lines.slice(1).join(' ').trim() || trimmed;

    // We don't have a URL — use a placeholder so the commenter can find the post
    results.push({
      postUrl: null,  // URL unknown — bot will navigate by search or skip
      postText: body,
      authorName,
      authorHeadline: lines[1] || '',
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────
//  DEDUPLICATE + FILTER
// ─────────────────────────────────────────────────────────────────

function deduplicatePosts(posts) {
  const seenUrls = new Set();
  const seenText = new Set();
  return posts.filter((p) => {
    const textKey = p.postText.slice(0, 60);
    if (seenText.has(textKey)) return false;
    seenText.add(textKey);
    if (p.postUrl) {
      if (seenUrls.has(p.postUrl)) return false;
      seenUrls.add(p.postUrl);
    }
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────
//  MAIN EXPORT
// ─────────────────────────────────────────────────────────────────

async function findOneInterestingPost(page, commentedUrls = new Set()) {
  await ensureOnFeed(page);
  await scrollFeed(page, 10);

  // Run all strategies, stop when one finds posts
  let posts = [];
  const strategies = [
    { name: 'Link-walk (A+B)', fn: () => collectByLinkWalk(page) },
    { name: 'data-urn walk (C)', fn: () => collectByDataUrn(page) },
    { name: 'body.innerText parse (D)', fn: () => collectByBodyText(page) },
  ];

  for (const { name, fn } of strategies) {
    console.log(`  Trying strategy: ${name}...`);
    try {
      const found = await fn();
      if (found.length > 0) {
        console.log(`  ✓ Strategy "${name}" found ${found.length} post(s).`);
        posts = found;
        break;
      }
      console.log(`    → 0 posts found.`);
    } catch (e) {
      console.log(`    → Error: ${e.message.slice(0, 60)}`);
    }
  }

  if (posts.length === 0) {
    console.log('\n  ⚠️  All strategies found 0 posts.');
    console.log('  Possible causes:');
    console.log('    1. LinkedIn session shows a blank/empty feed');
    console.log('    2. Anti-bot detection — try deleting ./session and logging in fresh');
    console.log('    3. LinkedIn changed its DOM again — run: node debug-feed.js to inspect');
    return null;
  }

  posts = deduplicatePosts(posts);

  console.log('\n  Candidates:');
  for (const p of posts.slice(0, 8)) {
    const name = (p.authorName || 'Unknown').slice(0, 30).padEnd(30);
    const preview = p.postText.slice(0, 55).replace(/\n/g, ' ');
    console.log(`    • ${name}  "${preview}..."`);
  }

  console.log('\n  Applying filters...');
  for (const post of posts) {
    const { postUrl, postText, authorName, authorHeadline } = post;

    // Skip if no URL (Strategy D) and nothing to navigate to
    if (!postUrl) {
      console.log(`  [SKIP] No URL resolved for post by ${authorName}`);
      continue;
    }

    // Dedup check
    if (commentedUrls.has(postUrl)) {
      console.log(`  [SKIP] Already commented → ${authorName}`);
      continue;
    }

    // Author / post type check
    const { skip, reason } = shouldSkip(authorName, authorHeadline, postText);
    if (skip) {
      console.log(`  [SKIP] ${reason} → ${authorName}`);
      continue;
    }

    // Interest score
    const { score, interesting } = heuristicInterestScore(postText);
    if (!interesting) {
      console.log(`  [SKIP] Low interest score (${score}) → ${authorName}`);
      continue;
    }

    console.log(`\n  ✅ Picked: "${authorName}" (score: ${score}/100)`);
    return post;
  }

  console.log('\n  ⚠️  All posts were filtered out.');
  console.log('  Tips:');
  console.log('    • Run: node debug-feed.js   ← inspects what is actually in the DOM');
  console.log('    • Lower MIN_INTEREST_SCORE in .env');
  console.log('    • Edit GOOD_SIGNALS in src/linkedin/filters.js');
  return null;
}

// ─────────────────────────────────────────────────────────────────
//  PROFILE SCRAPER (optional)
// ─────────────────────────────────────────────────────────────────

async function scrapeProfilePosts(page, profileUrl, profileName) {
  const posts = [];
  if (!profileUrl || profileUrl.includes('example')) return posts;
  const activityUrl = profileUrl.replace(/\/$/, '') + '/recent-activity/shares/';
  console.log(`  Scraping: ${profileName || profileUrl}`);
  try {
    await page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(900);
    }
    const found = await collectByLinkWalk(page);
    for (const p of found) posts.push({ ...p, authorName: profileName || p.authorName });
    console.log(`  Got ${posts.length} post(s) from ${profileName}`);
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
  return posts;
}

module.exports = { findOneInterestingPost, scrapeProfilePosts };
