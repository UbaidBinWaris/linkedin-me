'use strict';
/**
 * debug-feed.js — Diagnostic tool
 * Run: node debug-feed.js
 *
 * Opens the browser, navigates to the feed, scrolls, then dumps:
 *   • All <a href> patterns found
 *   • First 3000 chars of body text
 * This tells us exactly what URL patterns LinkedIn is using for posts.
 */
require('dotenv').config();
const { createSession } = require('./src/browser/session');

async function debug() {
  console.log('Opening browser...');
  const { browser, page } = await createSession();

  console.log('Scrolling feed...');
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollBy(0, 700));
    await page.waitForTimeout(1000);
  }

  console.log('\n────────────────────────────────────────────');
  console.log('PAGE URL:', page.url());
  console.log('────────────────────────────────────────────');

  const info = await page.evaluate(() => {
    // Collect unique href patterns
    const hrefs = new Set();
    document.querySelectorAll('a[href]').forEach((a) => {
      const h = (a.getAttribute('href') || '').split('?')[0];
      // Only log interesting ones
      if (
        h.includes('/feed/') || h.includes('/posts/') ||
        h.includes('/pulse/') || h.includes('urn:li') ||
        h.includes('/in/') || h.includes('ugcPost') ||
        h.includes('activity')
      ) {
        hrefs.add(h.slice(0, 120));
      }
    });

    // Collect data-urn attributes
    const urns = new Set();
    document.querySelectorAll('[data-urn]').forEach((el) => {
      urns.add(el.getAttribute('data-urn'));
    });

    return {
      hrefSamples: [...hrefs].slice(0, 30),
      urnSamples: [...urns].slice(0, 20),
      bodyPreview: document.body.innerText.slice(0, 2000),
      totalLinks: document.querySelectorAll('a[href]').length,
    };
  });

  console.log(`\nTotal <a> links on page: ${info.totalLinks}`);
  console.log('\n── Interesting href patterns ──────────────────');
  info.hrefSamples.forEach((h) => console.log(' ', h));

  console.log('\n── data-urn values ────────────────────────────');
  info.urnSamples.forEach((u) => console.log(' ', u));

  console.log('\n── Body text preview (first 2000 chars) ───────');
  console.log(info.bodyPreview);

  console.log('\n────────────────────────────────────────────');
  console.log('Done. Press Ctrl+C to exit.');

  // Keep browser open
  await new Promise(() => {});
}

debug().catch(console.error);
