'use strict';
const { randomDelay } = require('../browser/session');

/**
 * Scrapes recent posts from a LinkedIn profile's activity page.
 * Returns an array of { postUrl, postText, authorName }.
 *
 * @param {import('playwright').Page} page
 * @param {string} profileUrl - The LinkedIn profile URL (e.g. https://www.linkedin.com/in/username/)
 * @param {string} profileName - Display name for logging
 * @returns {Promise<Array<{postUrl: string, postText: string, authorName: string}>>}
 */
async function scrapeProfilePosts(page, profileUrl, profileName) {
  const posts = [];

  // Navigate to the "Posts" activity tab of the profile
  // LinkedIn activity page URL pattern
  const normalizedUrl = profileUrl.replace(/\/$/, '');
  const activityUrl = `${normalizedUrl}/recent-activity/shares/`;

  console.log(`  📄 Checking posts from: ${profileName || profileUrl}`);

  try {
    await page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(randomDelay());

    // Check if we got a valid page (not 404 or redirected to login)
    const url = page.url();
    if (url.includes('/login') || url.includes('/checkpoint')) {
      console.log(`  ⚠️  Session expired during feed scrape. Aborting.`);
      return posts;
    }

    // Scroll down a bit to load more content
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(1500);

    // Try to find post containers using various possible selectors
    const postSelectors = [
      '.feed-shared-update-v2',
      '[data-urn*="urn:li:activity"]',
      '.occludable-update',
    ];

    let postElements = [];
    for (const selector of postSelectors) {
      postElements = await page.$$(selector);
      if (postElements.length > 0) break;
    }

    if (postElements.length === 0) {
      console.log(`  ℹ️  No posts found for ${profileName}. They may have no recent posts.`);
      return posts;
    }

    console.log(`  🔍 Found ${postElements.length} post(s) for ${profileName}`);

    for (const postEl of postElements.slice(0, 5)) {
      try {
        // Extract post text
        const textEl = await postEl.$('.feed-shared-update-v2__description, .break-words, [data-test-id="main-feed-activity-card__commentary"]');
        let postText = '';
        if (textEl) {
          postText = (await textEl.innerText()).trim();
        }

        // Extract post URL from the timestamp/link
        const linkEl = await postEl.$('a[href*="/feed/update/"], a[href*="activityUrn"], .feed-shared-update-v2__content-container a[href*="activity"]');
        let postUrl = '';
        if (linkEl) {
          postUrl = await linkEl.getAttribute('href');
          // Make absolute
          if (postUrl && !postUrl.startsWith('http')) {
            postUrl = 'https://www.linkedin.com' + postUrl;
          }
          // Clean query params for deduplication
          postUrl = postUrl.split('?')[0];
        }

        // Fall back to looking for any update link
        if (!postUrl) {
          const anyLink = await postEl.$('a[href*="update"]');
          if (anyLink) {
            postUrl = await anyLink.getAttribute('href');
            if (postUrl && !postUrl.startsWith('http')) {
              postUrl = 'https://www.linkedin.com' + postUrl;
            }
            postUrl = postUrl ? postUrl.split('?')[0] : '';
          }
        }

        if (!postText || !postUrl) continue;
        if (postText.length < 50) continue; // Skip very short posts

        posts.push({
          postUrl,
          postText,
          authorName: profileName || 'Unknown',
        });
      } catch (err) {
        // Skip individual post errors silently
      }
    }
  } catch (err) {
    console.log(`  ⚠️  Error scraping ${profileName}: ${err.message}`);
  }

  return posts;
}

/**
 * Scrapes posts from the LinkedIn home feed (for people you follow).
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{postUrl: string, postText: string, authorName: string}>>}
 */
async function scrapeFeedPosts(page) {
  const posts = [];

  console.log('  📰 Scraping LinkedIn home feed...');

  try {
    await page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(randomDelay());

    // Scroll to load more posts
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1200);
    }

    const postElements = await page.$$('.feed-shared-update-v2, .occludable-update');
    console.log(`  🔍 Found ${postElements.length} post(s) in feed`);

    for (const postEl of postElements.slice(0, 15)) {
      try {
        // Get post text
        const textEl = await postEl.$('.feed-shared-update-v2__description, .break-words');
        let postText = '';
        if (textEl) {
          postText = (await textEl.innerText()).trim();
        }
        if (!postText || postText.length < 50) continue;

        // Get author name
        const authorEl = await postEl.$('.feed-shared-actor__name, .update-components-actor__name');
        let authorName = 'Unknown';
        if (authorEl) {
          authorName = (await authorEl.innerText()).trim();
        }

        // Get post URL
        const linkEl = await postEl.$('a[href*="/feed/update/"]');
        let postUrl = '';
        if (linkEl) {
          postUrl = await linkEl.getAttribute('href');
          if (postUrl && !postUrl.startsWith('http')) {
            postUrl = 'https://www.linkedin.com' + postUrl;
          }
          postUrl = postUrl ? postUrl.split('?')[0] : '';
        }

        if (!postUrl) continue;

        posts.push({ postUrl, postText, authorName });
      } catch {
        // Skip errors silently
      }
    }
  } catch (err) {
    console.log(`  ⚠️  Error scraping feed: ${err.message}`);
  }

  return posts;
}

module.exports = {
  scrapeProfilePosts,
  scrapeFeedPosts,
};
