'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const config = require('../config');

const LINKEDIN_FEED  = 'https://www.linkedin.com/feed/';
const LINKEDIN_LOGIN = 'https://www.linkedin.com/login';

// ───────────────── Helpers ─────────────────

function waitForEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => { rl.close(); resolve(); });
  });
}

function randomDelay() {
  return (
    Math.floor(Math.random() * (config.bot.maxDelayMs - config.bot.minDelayMs + 1))
    + config.bot.minDelayMs
  );
}

// ───────────────── Browser launch ─────────────────

async function launchBrowser() {
  const sessionDir = path.resolve(config.browser.sessionDir);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: config.browser.headless,
    viewport: { width: 1366, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  return { browser: context, page };
}

// ───────────────── Session validation ─────────────────

/**
 * Checks if we are already logged in.
 * Strategy: navigate to feed, wait a moment, then check the URL.
 * We do NOT require specific feed elements – just that LinkedIn
 * did NOT redirect us to /login or /authwall.
 */
async function isSessionValid(page) {
  try {
    await page.goto(LINKEDIN_FEED, { waitUntil: 'domcontentloaded', timeout: 25000 });
    // Give the SPA a couple of seconds to decide where to redirect
    await page.waitForTimeout(3000);

    const url = page.url();

    // Any of these in the URL means we are NOT logged in
    const badPatterns = ['/login', '/authwall', '/checkpoint', '/uas/'];
    for (const bad of badPatterns) {
      if (url.includes(bad)) return false;
    }

    // We are on a linkedin.com page that is NOT login → session is good
    return url.includes('linkedin.com');
  } catch {
    return false;
  }
}

// ───────────────── Login flow ─────────────────

async function performManualLogin(page) {
  console.log('\n🔐 No valid session. Opening LinkedIn login page...');
  await page.goto(LINKEDIN_LOGIN, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1500);

  // Auto-fill if credentials are supplied
  if (config.linkedin.email && config.linkedin.password) {
    try {
      await page.fill('#username', config.linkedin.email);
      await page.waitForTimeout(400);
      await page.fill('#password', config.linkedin.password);
      console.log('✅ Credentials auto-filled — click "Sign in" or handle 2FA in the browser.');
    } catch {
      console.log('⚠️  Could not auto-fill credentials. Please log in manually in the browser.');
    }
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log('  📋 Complete the login in the browser window.');
  console.log('  ✔  Once you are on the LinkedIn feed, come back here.');
  console.log('──────────────────────────────────────────────────');
  await waitForEnter('  Press ENTER after you are logged in and see the feed...\n');

  // Final sanity-check
  const url = page.url();
  if (url.includes('/login') || url.includes('/authwall')) {
    throw new Error('Login appears to have failed. Please try again.');
  }
  console.log(`✅ Login confirmed! Session saved to: ${config.browser.sessionDir}\n`);
}

// ───────────────── Public API ─────────────────

async function createSession() {
  const { browser, page } = await launchBrowser();

  console.log('🔍 Checking for existing session...');
  const valid = await isSessionValid(page);

  if (valid) {
    console.log('✅ Session restored — no login needed.\n');
  } else {
    await performManualLogin(page);
    // Confirm we are on the feed after login
    await page.goto(LINKEDIN_FEED, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  return { browser, page };
}

async function closeSession(browser) {
  await browser.close();
}

module.exports = { createSession, closeSession, randomDelay };
