'use strict';
/**
 * feed.js — LinkedIn feed scraper + post finder
 *
 * Uses 3 DOM strategies (link walk → data-urn → body text).
 * Applies hard filters + composite scoring to all candidates.
 * Returns the HIGHEST-SCORED post the bot hasn't already interacted with.
 *
 * Accepts recentAuthors so the 7-day author cooldown is enforced
 * INSIDE the ranking loop — not outside — so we fall through to
 * the next-best post instead of exiting.
 */

const { shouldSkip, compositeScore } = require('./filters');

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
//  SCROLL — randomized amounts for human realism
// ─────────────────────────────────────────────────────────────────

async function scrollFeed(page, passes = 10) {
  console.log(`  Scrolling feed (${passes} passes)...`);
  for (let i = 0; i < passes; i++) {
    const amount = 400 + Math.floor(Math.random() * 500);
    await page.evaluate((px) => window.scrollBy(0, px), amount);
    await page.waitForTimeout(700 + Math.floor(Math.random() * 600));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
}

// ─────────────────────────────────────────────────────────────────
//  ENGAGEMENT EXTRACTION — parses "1.2K reactions · 45 comments"
// ─────────────────────────────────────────────────────────────────

function parseEngagement(cardText = '') {
  let reactionCount = 0;
  let commentCount  = 0;
  const reactionMatch = cardText.match(/([\d,\.]+\s*[Kk]?)\s+reactions?/i);
  const commentMatch  = cardText.match(/([\d,\.]+\s*[Kk]?)\s+comments?/i);
  if (reactionMatch) reactionCount = parseCount(reactionMatch[1]);
  if (commentMatch)  commentCount  = parseCount(commentMatch[1]);
  return { reactionCount, commentCount };
}

function parseCount(str = '') {
  const s = str.replace(/,/g, '').trim().toUpperCase();
  if (s.includes('K')) return Math.round(parseFloat(s) * 1000);
  return parseInt(s) || 0;
}

// ─────────────────────────────────────────────────────────────────
//  IS REAL AUTHOR NAME?
//  Filters out LinkedIn UI labels like "Feed post number 3",
//  "LinkedIn Member", "Unknown", single-word noise, etc.
// ─────────────────────────────────────────────────────────────────

function isRealAuthorName(name = '') {
  if (!name || name.length < 3 || name.length > 80) return false;
  const lower = name.toLowerCase();
  const fakePatterns = [
    /^feed post/i,
    /^linkedin member/i,
    /^unknown/i,
    /^post number/i,
    /^sponsored/i,
    /^promoted/i,
    /^\d+$/,               // pure number
    /^see more/i,
    /^following/i,
    /^follow$/i,
    /^connect$/i,
    /^message$/i,
    /^like$/i,
    /^comment$/i,
    /^share$/i,
    /^send$/i,
  ];
  if (fakePatterns.some((re) => re.test(lower))) return false;
  // A real name should have at least one letter
  if (!/[a-zA-Z]/.test(name)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────
//  AUTHOR NAME PARSER — shared logic for DOM text → author name
// ─────────────────────────────────────────────────────────────────

function parseAuthorFromLines(lines) {
  let authorName    = '';
  let authorHeadline = '';
  let bodyStart      = 0;

  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const ln = lines[i];
    const wc = ln.split(/\s+/).filter(Boolean).length;

    if (!ln || ln.length > 80 || ln.includes('http')) {
      if (authorName) break;
      continue;
    }

    if (!authorName) {
      if (wc >= 1 && wc <= 8 && isRealAuthorName(ln)) {
        authorName = ln;
        bodyStart  = i + 1;
      }
    } else if (!authorHeadline && wc <= 14) {
      authorHeadline = ln;
      bodyStart = i + 1;
    } else {
      break;
    }
  }

  const postText = lines.slice(bodyStart).join(' ').trim();
  
  // connection extraction (heuristically from headline or subtitle)
  const isConnection = authorHeadline.toLowerCase().includes('1st') || 
                       lines.slice(0, 3).some(l => l.toLowerCase().includes('1st'));

  return { 
    authorName: authorName || 'Unknown', 
    authorHeadline, 
    postText,
    isConnection 
  };
}

// ─────────────────────────────────────────────────────────────────
// The global metrics extractor was removed since it relies on DOM objects
// that cannot cross the evaluate boundary

// ─────────────────────────────────────────────────────────────────
//  STRATEGY A+B — Link Walk on /posts/ and /feed/update/ anchors
// ─────────────────────────────────────────────────────────────────

async function collectByLinkWalk(page) {
  return page.evaluate(() => {
    function isRealAuthorName(name = '') {
      if (!name || name.length < 3 || name.length > 80) return false;
      const lower = name.toLowerCase();
      const fakePatterns = [
        /^feed post/i, /^linkedin member/i, /^unknown/i, /^post number/i,
        /^sponsored/i, /^promoted/i, /^\d+$/, /^see more/i, /^following/i,
        /^follow$/i, /^connect$/i, /^message$/i, /^like$/i, /^comment$/i,
        /^share$/i, /^send$/i,
      ];
      if (fakePatterns.some((re) => re.test(lower))) return false;
      if (!/[a-zA-Z]/.test(name)) return false;
      return true;
    }

    function parseAuthorFromLines(lines) {
      let authorName = '';
      let authorHeadline = '';
      let bodyStart = 0;
      for (let i = 0; i < Math.min(lines.length, 15); i++) {
        const ln = lines[i];
        const wc = ln.split(/\s+/).filter(Boolean).length;
        if (!ln || ln.length > 80 || ln.includes('http')) {
          if (authorName) break;
          continue;
        }
        if (!authorName) {
          if (wc >= 1 && wc <= 8 && isRealAuthorName(ln)) {
            authorName = ln;
            bodyStart = i + 1;
          }
        } else if (!authorHeadline && wc <= 14) {
          authorHeadline = ln;
          bodyStart = i + 1;
        } else {
          break;
        }
      }
      const postText = lines.slice(bodyStart).join(' ').trim();
      const isConnection = authorHeadline.toLowerCase().includes('1st') || 
                           lines.slice(0, 3).some(l => l.toLowerCase().includes('1st'));
      return { authorName: authorName || 'Unknown', authorHeadline, postText, isConnection };
    }

    const results  = [];
    const seenUrls = new Set();

    const anchors = new Set([
      ...document.querySelectorAll('a[href*="/posts/"]'),
      ...document.querySelectorAll('a[href*="/feed/update/"]'),
      ...document.querySelectorAll('a[href*="ugcPost"]'),
      ...document.querySelectorAll('a[href*="activity"]'),
    ]);

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      if (!href) continue;
      if (/\/(company|jobs|learning|messaging|notifications|mynetwork)\/?/.test(href)) continue;
      if (href === '/feed/' || href === '/') continue;

      const url = href.startsWith('http')
        ? href.split('?')[0]
        : 'https://www.linkedin.com' + href.split('?')[0];

      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      // Walk UP to find post card (150-30000 chars)
      let el = anchor.parentElement;
      let cardText = '';
      for (let d = 0; d < 25 && el && el.tagName !== 'BODY'; d++) {
        const t = (el.innerText || '').trim();
        if (t.length >= 150 && t.length <= 30000) { cardText = t; break; }
        el = el.parentElement;
      }
      if (!cardText || cardText.length < 120 || !el) continue;

      const lines = cardText.split('\n').map((l) => l.trim()).filter(Boolean);
      const authorInfo = parseAuthorFromLines(lines);

      // Extract metrics
      let postFormat = 'text';
      if (el.querySelector('.update-components-poll')) postFormat = 'poll';
      else if (el.querySelector('.update-components-document')) postFormat = 'carousel';
      else if (el.querySelector('video') || el.querySelector('.update-components-video')) postFormat = 'video';
      else if (el.querySelector('img.update-components-image__image')) postFormat = 'image';

      let commentsData = [];
      let authorReplied = false;
      const commentElems = el.querySelectorAll('.comments-comment-item');
      for (let i = 0; i < Math.min(commentElems.length, 3); i++) {
        const cEl = commentElems[i];
        const textNode = cEl.querySelector('.comments-comment-item__main-content');
        const authorNode = cEl.querySelector('.comments-post-meta__name-text');
        if (textNode) commentsData.push(textNode.innerText.trim());
        if (authorNode && authorInfo.authorName) {
          if (authorNode.innerText.trim().toLowerCase() === authorInfo.authorName.toLowerCase()) {
            authorReplied = true;
          }
        }
      }

      let postAge = '';
      const metaNode = el.querySelector('.update-components-actor__sub-description');
      if (metaNode) postAge = metaNode.innerText.trim();

      results.push({ 
        postUrl: url, 
        cardText,
        authorName: authorInfo.authorName,
        authorHeadline: authorInfo.authorHeadline,
        postText: authorInfo.postText,
        isConnection: authorInfo.isConnection,
        postFormat,
        commentsData,
        authorReplied,
        postAge
      });
    }

    return results;
  }).then((raw) => raw.filter((p) => p.postText.length >= 80));
}

// ─────────────────────────────────────────────────────────────────
//  STRATEGY C — data-urn walk
// ─────────────────────────────────────────────────────────────────

async function collectByDataUrn(page) {
  return page.evaluate(() => {
    function isRealAuthorName(name = '') {
      if (!name || name.length < 3 || name.length > 80) return false;
      const lower = name.toLowerCase();
      const fakePatterns = [
        /^feed post/i, /^linkedin member/i, /^unknown/i, /^post number/i,
        /^sponsored/i, /^promoted/i, /^\d+$/, /^see more/i, /^following/i,
        /^follow$/i, /^connect$/i, /^message$/i, /^like$/i, /^comment$/i,
        /^share$/i, /^send$/i,
      ];
      if (fakePatterns.some((re) => re.test(lower))) return false;
      if (!/[a-zA-Z]/.test(name)) return false;
      return true;
    }

    function parseAuthorFromLines(lines) {
      let authorName = '';
      let authorHeadline = '';
      let bodyStart = 0;
      for (let i = 0; i < Math.min(lines.length, 15); i++) {
        const ln = lines[i];
        const wc = ln.split(/\s+/).filter(Boolean).length;
        if (!ln || ln.length > 80 || ln.includes('http')) {
          if (authorName) break;
          continue;
        }
        if (!authorName) {
          if (wc >= 1 && wc <= 8 && isRealAuthorName(ln)) {
            authorName = ln;
            bodyStart = i + 1;
          }
        } else if (!authorHeadline && wc <= 14) {
          authorHeadline = ln;
          bodyStart = i + 1;
        } else {
          break;
        }
      }
      const postText = lines.slice(bodyStart).join(' ').trim();
      const isConnection = authorHeadline.toLowerCase().includes('1st') || 
                           lines.slice(0, 3).some(l => l.toLowerCase().includes('1st'));
      return { authorName: authorName || 'Unknown', authorHeadline, postText, isConnection };
    }

    const results = [];
    const seen    = new Set();
    const elems   = document.querySelectorAll('[data-urn*="activity"],[data-id*="activity"],[data-entity-urn]');

    for (const el of elems) {
      const urn = el.getAttribute('data-urn') || el.getAttribute('data-id') || el.getAttribute('data-entity-urn') || '';
      if (!urn || seen.has(urn)) continue;
      seen.add(urn);

      const match = urn.match(/activity[:\-](\d+)/);
      if (!match) continue;
      const postUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${match[1]}/`;

      const cardText = (el.innerText || '').trim();
      if (cardText.length < 150) continue;

      const lines = cardText.split('\n').map((l) => l.trim()).filter(Boolean);
      const authorInfo = parseAuthorFromLines(lines);

      // Extract metrics
      let postFormat = 'text';
      if (el.querySelector('.update-components-poll')) postFormat = 'poll';
      else if (el.querySelector('.update-components-document')) postFormat = 'carousel';
      else if (el.querySelector('video') || el.querySelector('.update-components-video')) postFormat = 'video';
      else if (el.querySelector('img.update-components-image__image')) postFormat = 'image';

      let commentsData = [];
      let authorReplied = false;
      const commentElems = el.querySelectorAll('.comments-comment-item');
      for (let i = 0; i < Math.min(commentElems.length, 3); i++) {
        const cEl = commentElems[i];
        const textNode = cEl.querySelector('.comments-comment-item__main-content');
        const authorNode = cEl.querySelector('.comments-post-meta__name-text');
        if (textNode) commentsData.push(textNode.innerText.trim());
        if (authorNode && authorInfo.authorName) {
          if (authorNode.innerText.trim().toLowerCase() === authorInfo.authorName.toLowerCase()) {
            authorReplied = true;
          }
        }
      }

      let postAge = '';
      const metaNode = el.querySelector('.update-components-actor__sub-description');
      if (metaNode) postAge = metaNode.innerText.trim();

      results.push({ 
        postUrl, 
        cardText,
        authorName: authorInfo.authorName,
        authorHeadline: authorInfo.authorHeadline,
        postText: authorInfo.postText,
        isConnection: authorInfo.isConnection,
        postFormat,
        commentsData,
        authorReplied,
        postAge
      });
    }
    return results;
  }).then((raw) => raw.filter((p) => p.postText.length >= 80));
}

// ─────────────────────────────────────────────────────────────────
//  STRATEGY D — body.innerText fallback
// ─────────────────────────────────────────────────────────────────

async function collectByBodyText(page) {
  const bodyText = await page.evaluate(() => document.body.innerText || '');
  if (bodyText.length < 500) return [];

  const results = [];
  const seen    = new Set();
  const chunks  = bodyText.split(/\n{2,}/);

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (trimmed.length < 120 || trimmed.length > 5000) continue;
    if (trimmed.split(/\s+/).length < 10) continue;
    const lower = trimmed.toLowerCase();
    if (/^(home|my network|jobs|messaging|notifications|search)/.test(lower)) continue;

    const key = trimmed.slice(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);

    const lines       = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    const { authorName, authorHeadline, postText, isConnection } = parseAuthorFromLines(lines);
    // Body parse has no DOM element container so we default the metrics
    results.push({ 
      postUrl: null, authorName, authorHeadline, postText, cardText: trimmed, isConnection,
      postFormat: 'text', commentsData: [], authorReplied: false, postAge: ''
    });
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────
//  DEDUP
// ─────────────────────────────────────────────────────────────────

function dedup(posts) {
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
//  MAIN
// ─────────────────────────────────────────────────────────────────

/**
 * Finds the highest-scored interesting post from the feed.
 *
 * @param {Page}    page
 * @param {Set}     commentedUrls  - Post URLs already commented on
 * @param {Array<number>} thresholds     - Array of fallback thresholds to use (e.g. [80, 70, 60])
 * @returns {Promise<object|null>}
 */
async function findOneInterestingPost(page, commentedUrls = new Set(), recentAuthors = new Set(), thresholds = [80, 70, 60]) {
  await ensureOnFeed(page);
  await scrollFeed(page, 10);

  let posts = [];
  const strategies = [
    { name: 'Link-walk (/posts/ + /feed/update/)', fn: () => collectByLinkWalk(page) },
    { name: 'data-urn walk',                       fn: () => collectByDataUrn(page) },
    { name: 'body.innerText parse',                fn: () => collectByBodyText(page) },
  ];

  for (const { name, fn } of strategies) {
    console.log(`  Trying: ${name}...`);
    try {
      const found = await fn();
      if (found.length > 0) {
        console.log(`  ✓ Found ${found.length} post(s).`);
        posts = found;
        break;
      }
    } catch (e) {
      console.log(`    → Error: ${e.message.slice(0, 60)}`);
    }
  }

  if (posts.length === 0) {
    console.log('\n  ⚠️  All strategies found 0 posts.');
    console.log('  → Run: node debug-feed.js to inspect live DOM');
    return null;
  }

  posts = dedup(posts);
  const total = posts.length;
  console.log(`\n  ${total} unique post(s) to evaluate.\n`);

  // ── Score every candidate ───────────────────────────────────────
  const candidates = [];

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];

    // Require a valid URL
    if (!post.postUrl) {
      console.log(`  [SKIP] No URL → ${post.authorName}`);
      continue;
    }

    // URL dedup
    if (commentedUrls.has(post.postUrl)) {
      console.log(`  [SKIP] Already commented → ${post.authorName}`);
      continue;
    }

    // Hard content/author filters
    const { skip, reason } = shouldSkip(post.authorName, post.authorHeadline, post.postText);
    if (skip) {
      console.log(`  [SKIP] ${reason} → ${post.authorName}`);
      continue;
    }

    // 7-day author cooldown — skip here inside loop so we fall to next candidate
    if (recentAuthors.has((post.authorName || '').toLowerCase())) {
      console.log(`  [SKIP] Author cooldown (7d) → ${post.authorName}`);
      continue;
    }

    // Engagement
    const { reactionCount, commentCount } = parseEngagement(post.cardText || '');

    // Composite score
    const { total: score, breakdown, shouldComment } = compositeScore({
      postText:       post.postText,
      authorHeadline: post.authorHeadline,
      reactionCount,
      commentCount,
      positionIndex:  i,
      totalPosts:     total,
    });

    const nameStr = (post.authorName || 'Unknown').slice(0, 28).padEnd(28);
    const engStr  = reactionCount ? `${reactionCount}👍 ${commentCount}💬` : 'no engagement data';
    const mark    = (score >= thresholds[thresholds.length - 1]) ? '[✓]' : '[✗]';
    console.log(`  ${mark} ${nameStr} | score:${score} (H:${breakdown.heuristic} E:${breakdown.engagement} V:${breakdown.visibility} S:${breakdown.seniority} N:${breakdown.niche} R:${breakdown.recency}) | ${engStr}`);

    if (score >= thresholds[thresholds.length - 1]) {
      candidates.push({ ...post, reactionCount, commentCount, compositeScore: score, breakdown });
    }
  }

  if (candidates.length === 0) {
    console.log(`\n  ⚠️  No posts met the minimum composite score threshold (${thresholds[thresholds.length - 1]}/100).`);
    console.log('  → Lower thresholds or broaden NICHE_SIGNALS in filters.js');
    return null;
  }

  // Find the highest threshold that has at least one matching candidate
  let activeThreshold = thresholds[thresholds.length - 1]; // default minimum
  for (const t of thresholds) {
    if (candidates.some(c => c.compositeScore >= t)) {
      activeThreshold = t;
      break;
    }
  }

  console.log(`\n  Dynamic Threshold Active: >= ${activeThreshold}`);

  // Filter candidates by active threshold and sort descending — pick the best
  const validCandidates = candidates.filter(c => c.compositeScore >= activeThreshold);
  validCandidates.sort((a, b) => b.compositeScore - a.compositeScore);
  const winner = validCandidates[0];

  console.log(`\n  🏆 Best post: "${winner.authorName}" (composite: ${winner.compositeScore}/100)`);
  console.log(`     Breakdown: H${winner.breakdown.heuristic} E${winner.breakdown.engagement} V${winner.breakdown.visibility} S${winner.breakdown.seniority} N${winner.breakdown.niche} R${winner.breakdown.recency}`);

  return winner;
}

// ─────────────────────────────────────────────────────────────────
//  PROFILE SCRAPER
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
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
  return posts;
}

// parseAuthorFromLines needs to be available in this module scope
// (called from the .then() chains above — hoisted via function declaration)
function parseAuthorFromLines(lines) {
  let authorName     = '';
  let authorHeadline = '';
  let bodyStart      = 0;

  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const ln = lines[i];
    const wc = ln.split(/\s+/).filter(Boolean).length;

    if (!ln || ln.length > 80 || ln.includes('http')) {
      if (authorName) break;
      continue;
    }

    // Reject known fake/accessibility names
    if (/^(feed post|linkedin member|sponsored|promoted|see more|following|connect|message|like|comment|share|send|\d+)$/i.test(ln)) continue;

    if (!authorName) {
      if (wc >= 1 && wc <= 8 && /[a-zA-Z]/.test(ln)) {
        authorName = ln;
        bodyStart  = i + 1;
      }
    } else if (!authorHeadline && wc <= 14) {
      authorHeadline = ln;
      bodyStart = i + 1;
    } else {
      break;
    }
  }

  const postText = lines.slice(bodyStart).join(' ').trim();
  
  const isConnection = authorHeadline.toLowerCase().includes('1st') || 
                       lines.slice(0, 3).some(l => l.toLowerCase().includes('1st'));

  return { 
    authorName: authorName || 'Unknown', 
    authorHeadline, 
    postText,
    isConnection 
  };
}

// ─────────────────────────────────────────────────────────────────
//  BATCH EXTRACTOR FOR BOT ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────

/**
 * Scrolls feed and returns all deduplicated candidates parsed.
 * Does not score or filter (except basic lengths).
 */
async function getFeedPostsBatch(page, passes = 5) {
  await ensureOnFeed(page);
  await scrollFeed(page, passes);

  let posts = [];
  const strategies = [
    { name: 'Link-walk (/posts/ + /feed/update/)', fn: () => collectByLinkWalk(page) },
    { name: 'data-urn walk',                       fn: () => collectByDataUrn(page) },
    { name: 'body.innerText parse',                fn: () => collectByBodyText(page) },
  ];

  for (const { name, fn } of strategies) {
    try {
      const found = await fn();
      if (found.length > 0) {
        posts = posts.concat(found);
      }
    } catch (e) {
      // ignore strategy errors in batch
    }
  }

  return dedup(posts);
}

module.exports = { findOneInterestingPost, scrapeProfilePosts, getFeedPostsBatch, parseEngagement };
