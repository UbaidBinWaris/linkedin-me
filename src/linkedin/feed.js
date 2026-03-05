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
const { extractPostId } = require('../data/csv');

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
  await sleep(4000);
}

// ─────────────────────────────────────────────────────────────────
//  SCROLL — randomized amounts for human realism
// ─────────────────────────────────────────────────────────────────

/** Plain-Promise sleep — page.waitForTimeout was removed in modern Playwright */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Returns the actual scrollable feed container by checking computed overflow.
 * LinkedIn often uses overflow:hidden on <main> but scrolls an inner div.
 * This runs inside page.evaluate — no Node.js API available.
 */
function _findScrollContainer() {
  // Priority selectors — checked first
  const prioritySelectors = [
    '.scaffold-layout__main',
    'div[class*="scaffold-finite-scroll"]',
    'div[class*="feed-container"]',
    'div[class*="artdeco-card"]',
    'main',
  ];
  for (const sel of prioritySelectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const oy = window.getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 100) {
      return el;
    }
  }
  // Generic fallback: find the deepest div with actual scroll capacity
  let best = null;
  let bestDiff = 200; // minimum threshold
  document.querySelectorAll('div, main, section').forEach((el) => {
    const diff = el.scrollHeight - el.clientHeight;
    if (diff <= bestDiff) return;
    const oy = window.getComputedStyle(el).overflowY;
    if (oy === 'auto' || oy === 'scroll') { best = el; bestDiff = diff; }
  });
  return best; // null → caller falls back to window
}

async function scrollFeed(page, passes = 10) {
  console.log(`  Scrolling feed (${passes} passes)...`);

  // Give the page keyboard focus so End/PageDown keys actually fire
  try { await page.click('body', { force: true }); } catch (_) {}

  for (let i = 0; i < passes; i++) {
    const amount = 600 + Math.floor(Math.random() * 700);
    try {
      // Identify the ACTUAL scrollable container via computed overflow each pass
      await page.evaluate((px) => {
        // _findScrollContainer is inlined here because page.evaluate is isolated
        const prioritySelectors = [
          '.scaffold-layout__main',
          'div[class*="scaffold-finite-scroll"]',
          'div[class*="feed-container"]',
          'div[class*="artdeco-card"]',
          'main',
        ];
        let container = null;
        for (const sel of prioritySelectors) {
          const el = document.querySelector(sel);
          if (!el) continue;
          const oy = window.getComputedStyle(el).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 100) {
            container = el; break;
          }
        }
        if (!container) {
          let bestDiff = 200;
          document.querySelectorAll('div, main, section').forEach((el) => {
            const diff = el.scrollHeight - el.clientHeight;
            if (diff <= bestDiff) return;
            const oy = window.getComputedStyle(el).overflowY;
            if (oy === 'auto' || oy === 'scroll') { container = el; bestDiff = diff; }
          });
        }
        if (container) container.scrollBy(0, px);
        else window.scrollBy(0, px);
      }, amount);

      // Send keyboard End key every 3rd pass (triggers LinkedIn's virtual loader)
      if (i % 3 === 2) {
        try { await page.keyboard.press('End'); } catch (_) {}
        await sleep(400);
      }

      await sleep(700 + Math.floor(Math.random() * 500));
    } catch (e) {
      if (e.message.includes('closed')) break;
    }
  }

  // Final flush — scroll every scrollable container to the bottom
  try {
    await page.evaluate(() => {
      let bestDiff = 200;
      let container = null;
      document.querySelectorAll('div, main, section').forEach((el) => {
        const diff = el.scrollHeight - el.clientHeight;
        if (diff <= bestDiff) return;
        const oy = window.getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll') { container = el; bestDiff = diff; }
      });
      if (container) container.scrollTop = container.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.keyboard.press('End');
    await sleep(1800);
  } catch (_) { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────
//  ENGAGEMENT EXTRACTION — parses "1.2K reactions · 45 comments"
// ─────────────────────────────────────────────────────────────────

function parseEngagement(cardText = '') {
  let reactionCount = 0;
  let commentCount  = 0;
  const reactionMatch = cardText.match(/([\d,\.]+\s*[KkMm]?)\s*(?:reactions?|likes?)/i);
  const commentMatch  = cardText.match(/([\d,\.]+\s*[KkMm]?)\s*comments?/i);
  if (reactionMatch) reactionCount = parseCount(reactionMatch[1]);
  if (commentMatch)  commentCount  = parseCount(commentMatch[1]);
  return { reactionCount, commentCount };
}

function parseCount(str = '') {
  const s = str.replace(/,/g, '').trim().toUpperCase();
  if (s.includes('M')) return Math.round(parseFloat(s) * 1000000);
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
    // LinkedIn UI section labels
    /^suggested$/i,
    /^promoted$/i,
    /^people you may know$/i,
    /^news$/i,
    /^advertisement$/i,
    // Social activity cards: "X commented on this", "X likes this", etc.
    /\bcommented on\b/i,
    /\blikes? this\b/i,
    /\bshared this\b/i,
    /\breacted to\b/i,
    /\breposted this\b/i,
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
        /^suggested$/i, /^promoted$/i, /^people you may know$/i,
        /^news$/i, /^advertisement$/i,
        /\bcommented on\b/i, /\blikes? this\b/i, /\bshared this\b/i,
        /\breacted to\b/i, /\breposted this\b/i,
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
      if (/\/(company|jobs|learning|messaging|notifications|mynetwork|groups)\/?/.test(href)) continue;
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

      let profileUrl = '';
      const authorLinks = el.querySelectorAll('a[href*="/in/"], a[href*="/company/"]');
      for (const lnk of authorLinks) {
        if (lnk.innerText && lnk.innerText.trim().toLowerCase().includes(authorInfo.authorName.toLowerCase())) {
          profileUrl = lnk.getAttribute('href') || '';
          break;
        }
      }
      if (!profileUrl && authorLinks.length > 0) {
        profileUrl = authorLinks[0].getAttribute('href') || '';
      }
      if (profileUrl && !profileUrl.startsWith('http')) {
        profileUrl = 'https://www.linkedin.com' + profileUrl.split('?')[0];
      } else if (profileUrl) {
        profileUrl = profileUrl.split('?')[0];
      }

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
        postAge,
        profileUrl
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
        /^suggested$/i, /^promoted$/i, /^people you may know$/i,
        /^news$/i, /^advertisement$/i,
        /\bcommented on\b/i, /\blikes? this\b/i, /\bshared this\b/i,
        /\breacted to\b/i, /\breposted this\b/i,
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

    /**
     * Decode a base64url-encoded LinkedIn componentkey proto into an activity ID.
     *
     * Strategy A: protobuf varint — tries every byte offset 0-7.
     * Strategy B: fixed-int64 window — slides an 8-byte window across every byte
     *   position and reads both little-endian and big-endian int64.
     *
     * A valid LinkedIn snowflake activity ID is in the range 6e18 – 9.99e18
     * (roughly 2022–2030 timestamps).
     */
    function decodeUrnBase64(b64url) {
      try {
        // Normalise URL-safe base64 → standard base64 and fix padding
        const b64    = b64url.replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        const raw    = atob(padded);
        const len    = raw.length;

        const LO = 6000000000000000000n;
        const HI = 9999999999999999999n;

        // ── Strategy A: protobuf varint ──────────────────────────────
        for (let startOffset = 0; startOffset < Math.min(len, 12); startOffset++) {
          let id       = 0n;
          let shift    = 0n;
          let overflow = false;
          for (let i = startOffset; i < len; i++) {
            const byte = raw.charCodeAt(i);
            id    |= BigInt(byte & 0x7f) << shift;
            shift += 7n;
            if ((byte & 0x80) === 0) break;
            if (shift > 70n) { overflow = true; break; }
          }
          if (!overflow && id >= LO && id <= HI) return id.toString();
        }

        // ── Strategy B: fixed-int64 window (LE and BE) ──────────────
        // LinkedIn uses proto fixed64 (little-endian) for some fields.
        for (let offset = 0; offset + 8 <= len; offset++) {
          // little-endian
          let le = 0n;
          for (let i = 7; i >= 0; i--) le = (le << 8n) | BigInt(raw.charCodeAt(offset + i));
          if (le >= LO && le <= HI) return le.toString();

          // big-endian
          let be = 0n;
          for (let i = 0; i < 8; i++) be = (be << 8n) | BigInt(raw.charCodeAt(offset + i));
          if (be >= LO && be <= HI) return be.toString();
        }

        return null;
      } catch (e) { return null; }
    }

    /**
     * Given a listitem / card element, try every available method to resolve
     * the LinkedIn activity URL.
     */
    function extractPostUrl(el) {
      // 1. New layout: componentkey="expanded<base64>FeedType_..."
      const ckAttr = el.getAttribute('componentkey') || '';
      const ckMatch = ckAttr.match(/^expanded([A-Za-z0-9_\-]{20,})FeedType_/);
      if (ckMatch) {
        const decoded = decodeUrnBase64(ckMatch[1]);
        if (decoded) return { urn: `urn:li:activity:${decoded}`, postUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${decoded}/` };
      }

      // 2. New layout: inner card componentkey (bare base64url, no expanded prefix)
      //    e.g. componentkey="UiufKd42P1_vf6lC5XXljq2DSiIUdmd1-dyCPSlIUDc"
      if (/^[A-Za-z0-9_\-]{30,60}$/.test(ckAttr)) {
        const decoded = decodeUrnBase64(ckAttr);
        if (decoded) return { urn: `urn:li:activity:${decoded}`, postUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${decoded}/` };
      }

      const html = el.innerHTML || '';

      // 3. Plaintext URN embedded in HTML
      const plain = html.match(/urn:li:activity:(\d{15,})/);
      if (plain) return { urn: `urn:li:activity:${plain[1]}`, postUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${plain[1]}/` };

      // 4. URL-encoded URN (e.g. in share hrefs)
      const encoded = html.match(/urn%3Ali%3Aactivity%3A(\d{15,})/);
      if (encoded) return { urn: `urn:li:activity:${encoded[1]}`, postUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${encoded[1]}/` };

      // 5. Directly search child componentkeys of inner card wrappers for the base64 pattern
      const innerCards = el.querySelectorAll('[componentkey]');
      for (const ic of innerCards) {
        const ick = ic.getAttribute('componentkey') || '';
        // Skip UUID-format keys (action buttons, etc.)
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(ick)) continue;
        if (/^[A-Za-z0-9_\-]{30,60}$/.test(ick)) {
          const decoded = decodeUrnBase64(ick);
          if (decoded) return { urn: `urn:li:activity:${decoded}`, postUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${decoded}/` };
        }
      }

      // 6. Legacy: base64 proto in data-testid="<id>-commentLists"
      const testIdMatch = html.match(/data-testid="([A-Za-z0-9_\-]+)-commentLists/);
      if (testIdMatch) {
        const decoded = decodeUrnBase64(testIdMatch[1]);
        if (decoded) return { urn: `urn:li:activity:${decoded}`, postUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${decoded}/` };
      }

      return null;
    }

    const results = [];
    const seen    = new Set();

    // ── Selector covers both the old data-attribute layout AND the new
    //    componentkey-based layout where each post is a [role="listitem"].
    //    The [componentkey*="FeedType_"] constraint targets only feed-post
    //    listitems (their componentkey ends with "FeedType_MAIN_FEED_RELEVANCE"
    //    etc.) and avoids spurious matches from nav/search listitems.
    const elems = document.querySelectorAll(
      '[data-urn*="activity"],[data-id*="activity"],[data-entity-urn],' +
      '[data-view-name="feed-full-update"],' +
      '[role="listitem"][componentkey*="FeedType_"]'
    );

    for (const el of elems) {
      let urn = el.getAttribute('data-urn') || el.getAttribute('data-id') || el.getAttribute('data-entity-urn') || '';
      let postUrl = '';

      if (urn) {
        // Old layout: build URL from data attribute directly
        const match = urn.match(/activity[:\-](\d+)/);
        if (match) postUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${match[1]}/`;
      }

      // New layout (or old layout that didn't yield a URL yet): try all extraction methods
      if (!postUrl) {
        const extracted = extractPostUrl(el);
        if (extracted) { urn = extracted.urn; postUrl = extracted.postUrl; }
      }

      // Still nothing? Check closest listitem parent (for old-layout children)
      if (!postUrl) {
        const parent = el.closest('[role="listitem"]');
        if (parent && parent !== el) {
          const extracted = extractPostUrl(parent);
          if (extracted) { urn = extracted.urn; postUrl = extracted.postUrl; }
        }
      }
      
      if (!urn || seen.has(urn) || !postUrl) continue;
      seen.add(urn);

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

      let profileUrl = '';
      const authorLinks = el.querySelectorAll('a[href*="/in/"], a[href*="/company/"]');
      for (const lnk of authorLinks) {
        if (lnk.innerText && lnk.innerText.trim().toLowerCase().includes(authorInfo.authorName.toLowerCase())) {
          profileUrl = lnk.getAttribute('href') || '';
          break;
        }
      }
      if (!profileUrl && authorLinks.length > 0) {
        profileUrl = authorLinks[0].getAttribute('href') || '';
      }
      if (profileUrl && !profileUrl.startsWith('http')) {
        profileUrl = 'https://www.linkedin.com' + profileUrl.split('?')[0];
      } else if (profileUrl) {
        profileUrl = profileUrl.split('?')[0];
      }

      const finalMatch = urn.match(/activity[:\-](\d+)/);
      const postId = finalMatch ? finalMatch[1] : (postUrl ? postUrl.split('activity:')[1].replace('/', '') : urn);

      results.push({ 
        urn,
        postId,
        postUrl, 
        cardText,
        authorName: authorInfo.authorName,
        authorHeadline: authorInfo.authorHeadline,
        postText: authorInfo.postText,
        isConnection: authorInfo.isConnection,
        postFormat,
        commentsData,
        authorReplied,
        postAge,
        profileUrl
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
    if (/^(home|my network|jobs|messaging|notifications|search|suggested)/.test(lower)) continue;

    const key = trimmed.slice(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);

    const lines       = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    const { authorName, authorHeadline, postText, isConnection } = parseAuthorFromLines(lines);
    // Body parse has no DOM element container so we default the metrics
    results.push({ 
      postUrl: null, authorName, authorHeadline, postText, cardText: trimmed, isConnection,
      postFormat: 'text', commentsData: [], authorReplied: false, postAge: '', profileUrl: ''
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
      const id = extractPostId(p.postUrl);
      if (seenUrls.has(id)) return false;
      seenUrls.add(id);
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
    const postId = extractPostId(post.postUrl);
    if (commentedUrls.has(postId)) {
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
    await sleep(3000);
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await sleep(900);
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
    // Reject social activity lines ("X commented on this", "X shared this", etc.)
    if (/\bcommented on\b|\blikes? this\b|\bshared this\b|\breacted to\b|\breposted this\b/i.test(ln)) continue;

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
  try {
    await scrollFeed(page, passes);
  } catch (e) {
    console.log(`  [!] Error scrolling feed: ${e.message}`);
  }

  let posts = [];
  const strategies = [
    { name: 'Link-walk (/posts/ + /feed/update/)', fn: () => collectByLinkWalk(page) },
    { name: 'data-urn walk',                       fn: () => collectByDataUrn(page) },
    { name: 'body.innerText parse',                fn: () => collectByBodyText(page) },
  ];

  for (const { name, fn } of strategies) {
    try {
      const found = await fn();
      console.log(`  [DEBUG] Strategy "${name}": ${found.length} post(s) found`);
      if (found.length > 0) {
        // Debug: show url/author for first 3 to spot null-URL issues
        found.slice(0, 3).forEach((p, idx) => {
          console.log(`    [${idx}] url=${p.postUrl || 'NULL'} | author=${p.authorName} | textLen=${p.postText.length}`);
        });
        posts = posts.concat(found);
      }
    } catch (e) {
      console.log(`  [DEBUG] Strategy "${name}" error: ${e.message}`);
    }
  }

  const dedupd = dedup(posts);
  console.log(`  [DEBUG] After dedup: ${dedupd.length} unique post(s) (raw: ${posts.length})`);
  return dedupd;
}

module.exports = { findOneInterestingPost, scrapeProfilePosts, getFeedPostsBatch, parseEngagement };
