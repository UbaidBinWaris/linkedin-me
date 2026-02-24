'use strict';
/**
 * feed.js — LinkedIn feed scraper
 *
 * Strategy:
 *  1. Navigate to feed, scroll to load content
 *  2. Extract full body.innerText + collect /in/ profile links from DOM
 *  3. Use OpenAI to parse raw text into structured posts (author + text)
 *  4. Match each author to a profile link → visit recent-activity/shares/
 *     to get the actual post URL
 *  5. If still no URL → use DOM /feed/update/ links directly
 *  6. Retry: if 0 posts found, click Home nav icon and try again
 */

const config = require('../config');

const JUNIOR_SIGNALS = [
  'open to work', 'looking for', 'actively looking',
  'seeking opportunity', 'seeking job', 'fresher', 'recent graduate',
  'new graduate', 'entry level', 'entry-level', 'aspiring',
  'career break', 'career switch', 'open to opportunities', 'job seeker',
];

function isOTWOrJunior(text = '') {
  return JUNIOR_SIGNALS.some((s) => text.toLowerCase().includes(s));
}

// ── OpenAI post parser ────────────────────────────────────────────
async function parsePostsWithAI(bodyText) {
  const { OpenAI } = require('openai');
  const ai = new OpenAI({ apiKey: config.openaiApiKey });

  const prompt = `You are parsing raw text scraped from a LinkedIn feed page.

Extract individual LinkedIn posts. Each post has:
- An author name (usually appears near the top of each post block)
- The actual post content (the body text — at least 80 characters)

Return a JSON array. Each object must have:
- "authorName": string
- "authorHeadline": string (author title/description, or "")
- "postText": string (at least 80 chars of real post content)

Rules:
- Skip nav menus, "People you may know", job posts, ads, follower counts alone
- Skip posts shorter than 80 characters  
- Skip open-to-work / job-seekers / students
- Do NOT skip posts just because they have no URL — include all valid posts
- Return ONLY the JSON array

Feed text (first 8000 chars):
"""
${bodyText.slice(0, 8000)}
"""`;

  const res = await ai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2000,
    temperature: 0.1,
  });

  const raw = res.choices[0].message.content.trim()
    .replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(raw);
}

// ── Find a post URL from an author's recent activity ──────────────
async function resolvePostUrl(page, profileUrl, postTextSnippet) {
  try {
    const activityUrl = profileUrl.replace(/\/$/, '') + '/recent-activity/shares/';
    await page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForTimeout(800);
    }

    // Find /feed/update/ links on this page
    const links = await page.evaluate((snippet) => {
      const anchors = [...document.querySelectorAll('a[href*="/feed/update/"]')];
      // If we have multiple links, try to match one whose context contains the post text
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        // Walk up to check text context
        let el = a.parentElement;
        for (let i = 0; i < 8 && el; i++) {
          const t = (el.innerText || '').toLowerCase();
          if (snippet && t.includes(snippet.toLowerCase().slice(0, 30))) {
            return [href.startsWith('http') ? href.split('?')[0] : 'https://www.linkedin.com' + href.split('?')[0]];
          }
          el = el.parentElement;
        }
      }
      // Return all links if no match found
      return anchors.slice(0, 3).map(a => {
        const href = a.getAttribute('href') || '';
        return href.startsWith('http') ? href.split('?')[0] : 'https://www.linkedin.com' + href.split('?')[0];
      });
    }, postTextSnippet);

    return links[0] || null;
  } catch {
    return null;
  }
}

// ── Reload feed by clicking home icon ─────────────────────────────
async function clickHomeAndWait(page) {
  console.log('  Refreshing feed by clicking Home...');

  // Navigate back to feed URL (most reliable)
  await page.goto('https://www.linkedin.com/feed/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(4000);

  // Also try clicking the Home icon if we can find it
  await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href="/feed/"], a[href="https://www.linkedin.com/feed/"]')];
    if (links[0]) links[0].click();
  }).catch(() => {});

  await page.waitForTimeout(3000);
}

// ── Collect DOM data from feed page ──────────────────────────────
async function collectFeedDom(page) {
  return page.evaluate(() => {
    const bodyText = document.body.innerText || '';

    // Collect /feed/update/ post URLs
    const updateLinks = [];
    const seenUpdate = new Set();
    document.querySelectorAll('a[href*="/feed/update/"], a[href*="ugcPost"]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const url = href.startsWith('http') ? href.split('?')[0] : 'https://www.linkedin.com' + href.split('?')[0];
      if (!seenUpdate.has(url)) { seenUpdate.add(url); updateLinks.push(url); }
    });

    // Collect /in/ profile links (one per post — the author link)
    const profileLinks = [];
    const seenProfile = new Set();
    document.querySelectorAll('a[href*="/in/"]').forEach((a) => {
      const href = (a.getAttribute('href') || '').split('?')[0];
      if (!href.includes('/in/')) return;
      const clean = href.startsWith('http') ? href : 'https://www.linkedin.com' + href;
      // Only consider short profile URLs (not /in/user/detail/contact-info/ etc)
      const parts = clean.replace('https://www.linkedin.com/in/', '').split('/');
      if (parts[0] && parts[0].length > 2 && parts.length <= 2) {
        if (!seenProfile.has(clean)) { seenProfile.add(clean); profileLinks.push(clean); }
      }
    });

    return { bodyText, updateLinks, profileLinks };
  });
}

// ── Main feed scraper ─────────────────────────────────────────────
async function scrapeFeedPosts(page, maxPosts = 30) {
  console.log('  Loading LinkedIn home feed...');

  // Navigate if not already on feed
  const currentUrl = page.url();
  if (!currentUrl.includes('/feed')) {
    await page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(4000);
  }

  const hasOpenAI = config.openaiApiKey && config.openaiApiKey.startsWith('sk-') && config.openaiApiKey.length > 20;
  const allPosts = [];
  const seenUrls = new Set();
  const seenTexts = new Set();

  // ── Try up to 2 passes (second pass refreshes feed) ──
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) {
      await clickHomeAndWait(page);
    }

    // Scroll to load content
    console.log(`  Scrolling to load posts (pass ${pass + 1})...`);
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollBy(0, 900));
      await page.waitForTimeout(1400);
    }
    await page.waitForTimeout(2000);

    const { bodyText, updateLinks, profileLinks } = await collectFeedDom(page);
    console.log(`  Page text: ${bodyText.length} chars | post links: ${updateLinks.length} | profile links: ${profileLinks.length}`);

    if (bodyText.length < 500) continue;

    // ── Add any direct /feed/update/ links found ──
    for (const url of updateLinks) {
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        // We'll match these to posts later
      }
    }

    // ── Parse with OpenAI ──
    let parsed = [];
    if (hasOpenAI) {
      try {
        console.log('  Parsing with OpenAI...');
        parsed = await parsePostsWithAI(bodyText);
        console.log(`  OpenAI found ${parsed.length} candidate posts`);
      } catch (e) {
        console.log('  OpenAI parse failed:', e.message.slice(0, 60));
      }
    }

    // ── Assign URLs to each parsed post ──
    const urlPool = [...updateLinks]; // available direct links
    const usedProfileUrls = new Set();

    for (const p of parsed) {
      if (!p.postText || p.postText.length < 80) continue;
      if (isOTWOrJunior(p.authorName + ' ' + p.authorHeadline + ' ' + p.postText)) continue;

      const textKey = p.postText.slice(0, 60);
      if (seenTexts.has(textKey)) continue;

      // Try to assign a URL
      let postUrl = '';

      // Option A: use a direct feed link if available
      if (urlPool.length > 0) {
        postUrl = urlPool.shift();
      }

      // Option B: find author's profile and visit their recent activity
      if (!postUrl && profileLinks.length > 0 && hasOpenAI) {
        // Match author name to a profile URL we haven't used yet
        for (const pUrl of profileLinks) {
          if (usedProfileUrls.has(pUrl)) continue;
          usedProfileUrls.add(pUrl);
          const resolved = await resolvePostUrl(page, pUrl, p.postText.slice(0, 50));
          if (resolved && !seenUrls.has(resolved)) {
            postUrl = resolved;
            break;
          }
        }
        // Navigate back to feed after visiting profile
        if (postUrl) {
          await page.goto('https://www.linkedin.com/feed/', {
            waitUntil: 'domcontentloaded', timeout: 20000,
          });
          await page.waitForTimeout(2000);
        }
      }

      if (!postUrl) continue; // can't comment without a URL

      seenTexts.add(textKey);
      seenUrls.add(postUrl);
      allPosts.push({
        postUrl,
        postText: p.postText,
        authorName: p.authorName || 'Unknown',
        authorHeadline: p.authorHeadline || '',
      });
    }

    // If we found enough posts, stop
    if (allPosts.length >= 3) break;
    // Otherwise do another pass
    console.log(`  Pass ${pass + 1} found ${allPosts.length} post(s). ${pass === 0 ? 'Retrying with feed refresh...' : ''}`);
  }

  const posts = allPosts.slice(0, maxPosts);
  console.log(`  Found ${posts.length} usable post(s) from LinkedIn feed`);
  return posts;
}

// ── DOM fallback link-walk ────────────────────────────────────────
async function linkWalkFallback(page) {
  return page.evaluate((juniorSignals) => {
    const results = [];
    const seenUrls = new Set();
    const links = [...document.querySelectorAll('a[href*="/feed/update/"]'),
                   ...document.querySelectorAll('a[href*="ugcPost"]')];
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const url = href.startsWith('http') ? href.split('?')[0] : 'https://www.linkedin.com' + href.split('?')[0];
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      let el = link.parentElement, postText = '';
      for (let i = 0; i < 12 && el; i++) {
        const t = el.innerText ? el.innerText.trim() : '';
        if (t.length >= 200 && t.length <= 6000) { postText = t; break; }
        el = el.parentElement;
      }
      if (postText.length < 120) continue;
      if (juniorSignals.some((s) => postText.toLowerCase().includes(s))) continue;
      const lines = postText.split('\n').filter(l => l.trim());
      results.push({ postUrl: url, postText: lines.slice(2).join(' ').trim() || postText, authorName: lines[0] || 'Unknown', authorHeadline: lines[1] || '' });
    }
    return results;
  }, JUNIOR_SIGNALS);
}

// ── Profile scraper (optional) ────────────────────────────────────
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
