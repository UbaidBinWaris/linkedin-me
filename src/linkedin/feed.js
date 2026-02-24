'use strict';

// OTW / junior profile filter
const JUNIOR_SIGNALS = [
  'open to work', 'looking for', 'actively looking',
  'seeking opportunity', 'seeking job', 'fresher', 'recent graduate',
  'new graduate', 'entry level', 'entry-level', 'aspiring',
  'career break', 'career switch', 'open to opportunities', 'job seeker',
];

function isOTWOrJunior(text = '') {
  return JUNIOR_SIGNALS.some((s) => text.toLowerCase().includes(s));
}

// ── Parse Voyager API JSON for post data ─────────────────────────
function parseVoyagerJson(json) {
  const posts = [];
  try {
    const items = json.included || json.elements || [];
    for (const item of items) {
      const text =
        item.commentary?.text?.text ||
        item.commentary?.text ||
        item.description?.text?.text ||
        item.description?.text ||
        item.text?.text ||
        '';
      if (!text || text.length < 80) continue;

      const authorName =
        item.actor?.name?.text ||
        item.actor?.alternativeNames?.[0] ||
        '';
      const authorHeadline =
        item.actor?.description?.text ||
        item.actor?.subDescription?.text ||
        '';

      if (isOTWOrJunior(authorName + ' ' + authorHeadline + ' ' + text)) continue;

      const urn = item.entityUrn || item.updateUrn || '';
      if (!urn) continue;
      const postUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`;

      posts.push({ postUrl: postUrl.split('?')[0], postText: text, authorName: authorName || 'Unknown', authorHeadline });
    }
  } catch { /* ignore */ }
  return posts;
}

// ─────────────────────────────────────────────────────────────────
//  HOME FEED SCRAPER
//  Strategy 1: call LinkedIn's Voyager API from INSIDE the browser
//              (inherits auth cookies automatically)
//  Strategy 2: listen for API responses on page.on('response')
//  Strategy 3: DOM /feed/update/ link-walk fallback
// ─────────────────────────────────────────────────────────────────

async function scrapeFeedPosts(page, maxPosts = 30) {
  const allPosts = [];
  const seenUrls = new Set();

  function addPosts(list) {
    for (const p of list) {
      if (p.postUrl && !seenUrls.has(p.postUrl) && p.postText?.length >= 80) {
        seenUrls.add(p.postUrl);
        allPosts.push(p);
      }
    }
  }

  console.log('  Loading LinkedIn home feed...');

  // ── Navigate to feed ──
  const currentUrl = page.url();
  if (!currentUrl.includes('/feed')) {
    await page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(4000);
  }

  // ── Strategy 1: In-browser fetch to LinkedIn Voyager API ──
  // Since the browser is authenticated (cookies set), we can call
  // LinkedIn's own internal API directly — no external auth needed.
  console.log('  Calling LinkedIn API from browser context...');
  const apiResult = await page.evaluate(async () => {
    // Extract CSRF token from JSESSIONID cookie (LinkedIn requires this)
    let csrfToken = '';
    for (const c of document.cookie.split(';')) {
      const [k, v] = c.trim().split('=');
      if (k.trim() === 'JSESSIONID') {
        csrfToken = decodeURIComponent(v || '').replace(/"/g, '');
        break;
      }
    }

    const headers = {
      'csrf-token': csrfToken,
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
      'accept': 'application/vnd.linkedin.normalized+json+2.1',
    };

    // Try multiple known Voyager API endpoints
    const endpoints = [
      '/voyager/api/feed/updatesV2?count=25&q=suppressed&start=0&updateType=CHRONOLOGICAL',
      '/voyager/api/feed/updatesV2?count=25&q=suppressed&start=0',
      '/voyager/api/feed/updatesV2?count=25&start=0',
      '/voyager/api/feed/updates?count=25&start=0',
    ];

    const results = [];
    for (const ep of endpoints) {
      try {
        const resp = await fetch(ep, { headers, credentials: 'include' });
        if (resp.ok) {
          const json = await resp.json();
          results.push({ endpoint: ep, ok: true, hasIncluded: !!(json.included?.length), json });
          break; // stop at first success
        } else {
          results.push({ endpoint: ep, ok: false, status: resp.status });
        }
      } catch (e) {
        results.push({ endpoint: ep, ok: false, error: e.message });
      }
    }
    return results;
  }).catch(() => []);

  // Process API results
  for (const r of apiResult) {
    if (r.ok && r.json) {
      const posts = parseVoyagerJson(r.json);
      addPosts(posts);
      if (posts.length > 0) {
        console.log(`  ✓ API "${r.endpoint.split('?')[0]}" → ${posts.length} post(s)`);
      }
    }
  }

  // ── Strategy 2: Non-blocking response listener while scrolling ──
  // Catches API calls that happen as the page lazy-loads more posts
  const onResponse = async (response) => {
    const url = response.url();
    if (!url.includes('/voyager/api/') && !url.includes('/feed/updates')) return;
    if (response.status() !== 200) return;
    try {
      const ct = response.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const json = await response.json().catch(() => null);
      if (!json) return;
      const posts = parseVoyagerJson(json);
      addPosts(posts);
    } catch { /* ignore */ }
  };

  page.on('response', onResponse);

  try {
    // Scroll to trigger more API calls (lazy-loading)
    console.log('  Scrolling to load more posts...');
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollBy(0, 900));
      await page.waitForTimeout(1500 + Math.random() * 400);

      // Also call API at different offsets to get more posts
      if (i === 3 || i === 6) {
        const offset = i === 3 ? 25 : 50;
        const extraPosts = await page.evaluate(async (start) => {
          let csrfToken = '';
          for (const c of document.cookie.split(';')) {
            const [k, v] = c.trim().split('=');
            if (k.trim() === 'JSESSIONID') { csrfToken = decodeURIComponent(v || '').replace(/"/g, ''); break; }
          }
          const headers = { 'csrf-token': csrfToken, 'x-restli-protocol-version': '2.0.0', 'x-li-lang': 'en_US', 'accept': 'application/vnd.linkedin.normalized+json+2.1' };
          try {
            const r = await fetch(`/voyager/api/feed/updatesV2?count=25&q=suppressed&start=${start}&updateType=CHRONOLOGICAL`, { headers, credentials: 'include' });
            if (r.ok) return r.json();
          } catch { }
          return null;
        }, offset).catch(() => null);
        if (extraPosts) addPosts(parseVoyagerJson(extraPosts));
      }
    }
    await page.waitForTimeout(2000);
  } finally {
    page.off('response', onResponse);
  }

  // ── Strategy 3: DOM link-walk fallback ──
  if (allPosts.length < 3) {
    console.log('  Trying DOM link-walk fallback...');
    const fallback = await linkWalkFallback(page);
    addPosts(fallback);
  }

  const posts = allPosts.slice(0, maxPosts);
  console.log(`  Found ${posts.length} total post(s) from LinkedIn feed`);
  return posts;
}

// ─── DOM fallback: walk up from /feed/update/ links ──────────────
async function linkWalkFallback(page) {
  return page.evaluate((juniorSignals) => {
    const results = [];
    const seenUrls = new Set();
    const links = [
      ...document.querySelectorAll('a[href*="/feed/update/"]'),
      ...document.querySelectorAll('a[href*="ugcPost"]'),
    ];
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const url = href.startsWith('http') ? href.split('?')[0] : 'https://www.linkedin.com' + href.split('?')[0];
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      let el = link.parentElement;
      let postText = '';
      for (let i = 0; i < 12 && el; i++) {
        const t = el.innerText ? el.innerText.trim() : '';
        if (t.length >= 200 && t.length <= 6000) { postText = t; break; }
        el = el.parentElement;
      }
      if (postText.length < 120) continue;
      if (juniorSignals.some((s) => postText.toLowerCase().includes(s))) continue;
      const lines = postText.split('\n').filter((l) => l.trim());
      results.push({
        postUrl: url,
        postText: lines.slice(2).join(' ').trim() || postText,
        authorName: lines[0] || 'Unknown',
        authorHeadline: lines[1] || '',
      });
    }
    return results;
  }, JUNIOR_SIGNALS);
}

// ─── Profile scraper (optional) ───────────────────────────────────
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
    const found = await linkWalkFallback(page);
    for (const p of found) posts.push({ ...p, authorName: profileName || p.authorName });
    console.log(`  Got ${posts.length} post(s) from ${profileName}`);
  } catch (e) {
    console.log(`  Error scraping ${profileName}: ${e.message}`);
  }
  return posts;
}

module.exports = { scrapeFeedPosts, scrapeProfilePosts };
