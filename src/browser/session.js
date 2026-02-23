'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const config = require('../config');

const LINKEDIN_HOME = 'https://www.linkedin.com';
const LINKEDIN_FEED = 'https://www.linkedin.com/feed/';
const LINKEDIN_LOGIN = 'https://www.linkedin.com/login';

/**
 * Prompts the user to press Enter in the terminal.
 * @param {string} message
 * @returns {Promise<void>}
 */
function waitForEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Returns a random delay between min and max ms.
 * @returns {number}
 */
function randomDelay() {
  return (
    Math.floor(
      Math.random() * (config.bot.maxDelayMs - config.bot.minDelayMs + 1)
    ) + config.bot.minDelayMs
  );
}

/**
 * Launches the browser with a persistent context (session storage).
 * If the session directory exists, cookies and local storage are reused.
 * @returns {Promise<{browser: import('playwright').BrowserContext, page: import('playwright').Page}>}
 */
async function launchBrowser() {
  const sessionDir = path.resolve(config.browser.sessionDir);

  // Ensure session directory exists
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: config.browser.headless,
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
  });

  // Stealth: remove webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  return { browser: context, page };
}

/**
 * Checks if the current session is still valid (logged in).
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function isSessionValid(page) {
  try {
    await page.goto(LINKEDIN_FEED, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const url = page.url();
    // If redirected to login page, session is invalid
    if (url.includes('/login') || url.includes('/checkpoint')) {
      return false;
    }
    // Check for the feed content
    const feedExists = await page.$('.scaffold-layout__main, [data-test-id="feed"], .feed-shared-update-v2');
    return feedExists !== null;
  } catch {
    return false;
  }
}

/**
 * Performs a manual login flow.
 * Opens LinkedIn login page and waits for the user to login manually,
 * then saves the session.
 * @param {import('playwright').Page} page
 */
async function performManualLogin(page) {
  console.log('\n🔐 No valid session found. Opening LinkedIn login page...');
  await page.goto(LINKEDIN_LOGIN, { waitUntil: 'domcontentloaded' });

  // Try auto-fill if credentials are available
  if (config.linkedin.email && config.linkedin.password) {
    try {
      await page.fill('#username', config.linkedin.email);
      await page.fill('#password', config.linkedin.password);
      console.log('✅ Credentials auto-filled. Please click "Sign in" or complete any verification.');
    } catch {
      console.log('Could not auto-fill credentials. Please login manually.');
    }
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log('  📋 Please complete the login in the browser window.');
  console.log('  ✔  Once you are on the LinkedIn feed, come back here.');
  console.log('──────────────────────────────────────────────────');
  await waitForEnter('  Press ENTER after you are logged in...\n');

  // Verify the login succeeded
  const url = page.url();
  if (url.includes('/login') || url.includes('/checkpoint')) {
    throw new Error('Login failed or checkpoint detected. Please try again.');
  }

  console.log('✅ Login successful! Session saved to:', config.browser.sessionDir);
}

/**
 * Main entry point: launches browser and ensures a valid session.
 * @returns {Promise<{browser: import('playwright').BrowserContext, page: import('playwright').Page}>}
 */
async function createSession() {
  const { browser, page } = await launchBrowser();

  const valid = await isSessionValid(page);
  if (valid) {
    console.log('✅ Existing session found — skipping login.');
  } else {
    await performManualLogin(page);
    // Navigate to feed after login to confirm
    await page.goto(LINKEDIN_FEED, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  return { browser, page };
}

/**
 * Closes the browser context gracefully.
 * @param {import('playwright').BrowserContext} browser
 */
async function closeSession(browser) {
  await browser.close();
}

module.exports = {
  createSession,
  closeSession,
  randomDelay,
};
