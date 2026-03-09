'use strict';
/**
 * connector.js — LinkedIn Connection Request Playwright Module
 *
 * Handles navigating to a profile and clicking Connect + optional note.
 *
 * EXPORTS:
 *   sendConnectionRequest(page, profileUrl, note, dryRun)
 *     → { sent: bool, skipped: bool, reason: string }
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function humanDelay(min = 1500, max = 3500) {
  await sleep(randomBetween(min, max));
}

/**
 * Types text character by character to mimic human typing.
 */
async function humanType(page, selector, text) {
  await page.click(selector);
  await sleep(300);
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomBetween(40, 110) });
  }
}

// ─────────────────────────────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────────────────────────────

/**
 * Navigate to a LinkedIn profile page and wait for it to load.
 * Returns false if navigation fails.
 */
async function navigateToProfile(page, profileUrl) {
  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);
    return true;
  } catch (e) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
//  CONNECT BUTTON RESOLUTION
// ─────────────────────────────────────────────────────────────────

/**
 * Resolves the Connect button on a profile page.
 *
 * LinkedIn shows Connect in three possible locations:
 *   1. Directly in the top card actions (most common)
 *   2. Inside a "More" dropdown menu
 *   3. As a "Follow" button when already following — Connect hidden in More
 *
 * Returns the button handle (locator) or null if not found.
 */
async function findConnectButton(page) {
  // Strategy 1: top-card direct Connect button
  const topCardConnect = page.locator(
    'button.pvs-profile-actions__action:has-text("Connect"), ' +
    'button[aria-label*="Invite"][aria-label*="to connect"], ' +
    'button.artdeco-button:has-text("Connect")'
  ).first();

  if (await topCardConnect.isVisible({ timeout: 3000 }).catch(() => false)) {
    return topCardConnect;
  }

  // Strategy 2: "More" overflow button → dropdown → Connect option
  const moreBtn = page.locator(
    'button[aria-label="More actions"], ' +
    'button.pvs-profile-actions__overflow-toggle, ' +
    'button:has-text("More")'
  ).first();

  if (await moreBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await moreBtn.click();
    await sleep(800);

    const dropdownConnect = page.locator(
      'div[role="listitem"] span:text-is("Connect"), ' +
      'li.artdeco-dropdown__item:has-text("Connect")'
    ).first();

    if (await dropdownConnect.isVisible({ timeout: 2000 }).catch(() => false)) {
      return dropdownConnect;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────
//  NOTE DIALOG
// ─────────────────────────────────────────────────────────────────

/**
 * Fills and submits the "Add a note" dialog.
 * Returns true if note was sent successfully.
 */
async function sendWithNote(page, note) {
  try {
    // Click "Add a note" button in the Connect dialog
    const addNoteBtn = page.locator(
      'button[aria-label="Add a note"], ' +
      'button:has-text("Add a note")'
    ).first();

    if (!(await addNoteBtn.isVisible({ timeout: 4000 }).catch(() => false))) {
      console.log('    [WARN] "Add a note" button not found. Sending without note.');
      return false;
    }

    await addNoteBtn.click();
    await sleep(700);

    // Fill the textarea
    const textarea = page.locator('textarea#custom-message, textarea[name="message"]').first();
    if (!(await textarea.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.log('    [WARN] Note textarea not found. Sending without note.');
      return false;
    }

    // Clear and type note
    await textarea.click();
    await sleep(300);
    await page.keyboard.selectAll();
    await page.keyboard.press('Backspace');
    await sleep(200);

    // Type character by character
    for (const char of note) {
      await page.keyboard.type(char, { delay: randomBetween(35, 95) });
    }
    await sleep(600);

    // Click Send
    const sendBtn = page.locator(
      'button[aria-label="Send invitation"], ' +
      'button:has-text("Send")'
    ).first();

    if (!(await sendBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      console.log('    [WARN] Send button not found after typing note.');
      return false;
    }

    await sendBtn.click();
    await sleep(1200);
    return true;

  } catch (e) {
    console.log(`    [WARN] Note dialog error: ${e.message.slice(0, 80)}`);
    return false;
  }
}

/**
 * Send without a note — clicks the plain "Send" or "Send without a note" button.
 */
async function sendWithoutNote(page) {
  try {
    const sendBtn = page.locator(
      'button[aria-label="Send without a note"], ' +
      'button:has-text("Send without a note"), ' +
      'button[aria-label="Send invitation"], ' +
      'button:has-text("Send")'
    ).first();

    if (!(await sendBtn.isVisible({ timeout: 4000 }).catch(() => false))) {
      return false;
    }

    await sendBtn.click();
    await sleep(1000);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
//  CHECK IF ALREADY CONNECTED / PENDING
// ─────────────────────────────────────────────────────────────────

async function isAlreadyConnectedOrPending(page) {
  try {
    // "Message" button in the top card → already 1st degree
    const msgBtn = page.locator(
      'button.pvs-profile-actions__action:has-text("Message"), ' +
      'a[href*="/messaging/thread/"]:has-text("Message")'
    ).first();
    if (await msgBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      return { yes: true, reason: 'Already connected (1st degree)' };
    }

    // "Pending" or "Withdraw" → invitation already sent
    const pendingBtn = page.locator(
      'button:has-text("Pending"), button:has-text("Withdraw")'
    ).first();
    if (await pendingBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      return { yes: true, reason: 'Connection request already pending' };
    }

    return { yes: false, reason: '' };
  } catch {
    return { yes: false, reason: '' };
  }
}

// ─────────────────────────────────────────────────────────────────
//  MAIN EXPORT
// ─────────────────────────────────────────────────────────────────

/**
 * Send a LinkedIn connection request to a profile.
 *
 * @param {import('playwright').Page} page    Playwright page
 * @param {string}  profileUrl               Full LinkedIn profile URL
 * @param {string}  note                     Personalised connection note (or '')
 * @param {boolean} dryRun                   If true, log but don't click
 * @returns {Promise<{ sent: boolean, skipped: boolean, reason: string }>}
 */
async function sendConnectionRequest(page, profileUrl, note = '', dryRun = false) {
  // Navigate
  const navOk = await navigateToProfile(page, profileUrl);
  if (!navOk) {
    return { sent: false, skipped: true, reason: 'Navigation failed' };
  }

  // Check if already connected or pending
  const { yes, reason: connReason } = await isAlreadyConnectedOrPending(page);
  if (yes) {
    return { sent: false, skipped: true, reason: connReason };
  }

  // Find Connect button
  const connectBtn = await findConnectButton(page);
  if (!connectBtn) {
    return { sent: false, skipped: true, reason: 'Connect button not found on profile' };
  }

  // DRY RUN — stop here
  if (dryRun) {
    return {
      sent: false,
      skipped: false,
      reason: '[DRY RUN] Would send connection' + (note ? ' with note' : ' without note'),
    };
  }

  // Click Connect
  await connectBtn.click();
  await sleep(1200);

  // Handle "How do you know X?" dialog if it appears
  const emailField = page.locator('input[name="email"]').first();
  if (await emailField.isVisible({ timeout: 2000 }).catch(() => false)) {
    return { sent: false, skipped: true, reason: 'LinkedIn requires email — profile outside network' };
  }

  // Send
  let finalSent;
  if (note && note.length > 0) {
    finalSent = await sendWithNote(page, note);
    if (!finalSent) {
      // Fallback: try to send without note (dialog may already be open)
      finalSent = await sendWithoutNote(page);
    }
  } else {
    finalSent = await sendWithoutNote(page);
  }

  if (finalSent) {
    return { sent: true, skipped: false, reason: '' };
  } else {
    return { sent: false, skipped: true, reason: 'Send button click failed' };
  }
}

module.exports = { sendConnectionRequest };
