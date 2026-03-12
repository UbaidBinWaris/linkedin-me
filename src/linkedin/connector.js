'use strict';
/**
 * connector.js — LinkedIn Connection Request (Playwright)
 *
 * Strategy (LinkedIn 2026):
 *   1. Navigate to the person's profile page.
 *   2. Click the "Connect" button (or find it inside the "More" menu).
 *   3. A modal dialog opens — click "Add a note", type note, click Send.
 *   4. If no note needed, click "Send without a note" directly.
 *
 * EXPORTS:
 *   sendConnectionRequest(page, profileUrl, note, dryRun, inviteUrl?)
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// ─────────────────────────────────────────────────────────────────
//  Extract vanity name from profile URL
// ─────────────────────────────────────────────────────────────────
function extractVanityName(profileUrl) {
  const m = profileUrl.match(/linkedin\.com\/in\/([^/?#]+)/);
  return m ? m[1] : null;
}

// ─────────────────────────────────────────────────────────────────
//  Fill note textarea (after modal is open)
// ─────────────────────────────────────────────────────────────────
async function fillNote(page, note) {
  const sel = [
    'textarea#custom-message',
    'textarea[name="message"]',
    'textarea[aria-label*="note" i]',
    'textarea[aria-label*="message" i]',
    'textarea[placeholder*="note" i]',
    'textarea[placeholder*="Add" i]',
    'textarea',
  ].join(', ');

  const ta = page.locator(sel).first();
  if (!(await ta.isVisible({ timeout: 5000 }).catch(() => false))) return false;

  await ta.click();
  await sleep(200);
  await page.keyboard.press('Control+a');
  await sleep(100);
  await page.keyboard.press('Backspace');
  await sleep(100);
  for (const ch of note) {
    await page.keyboard.type(ch, { delay: randomBetween(30, 70) });
  }
  await sleep(400);
  return true;
}

// ─────────────────────────────────────────────────────────────────
//  Click the final Send button inside the modal
// ─────────────────────────────────────────────────────────────────
async function clickSend(page) {
  const patterns = [
    'button[aria-label="Send invitation"]',
    'button[aria-label="Send now"]',
    'button[aria-label="Send without a note"]',
    'button[aria-label="Done"]',
    'button:has-text("Send invitation")',
    'button:has-text("Send now")',
    'button:has-text("Send without a note")',
    'button:has-text("Send")',
    'button:has-text("Done")',
    'input[type="submit"]',
  ];

  for (const sel of patterns) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        console.log(`    ✓ Send clicked via: ${sel}`);
        await sleep(2000);
        return true;
      }
    } catch { /* try next */ }
  }

  // DOM fallback — search all visible buttons for send-like text
  const clicked = await page.evaluate(() => {
    const keywords = ['send invitation', 'send now', 'send without a note', 'send', 'done'];
    const btns = [...document.querySelectorAll('button')];
    for (const btn of btns) {
      if (btn.disabled || btn.offsetParent === null) continue;
      const text = ((btn.innerText || '') + ' ' + (btn.getAttribute('aria-label') || '')).toLowerCase().trim();
      if (keywords.some((k) => text === k || text.startsWith(k))) {
        btn.click();
        return btn.innerText || btn.getAttribute('aria-label') || 'unknown';
      }
    }
    return null;
  }).catch(() => null);

  if (clicked) {
    console.log(`    ✓ Send clicked via DOM fallback: "${clicked}"`);
    await sleep(2000);
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────
//  Click the Connect button on the profile page
//  Returns true if a Connect button was found and clicked
// ─────────────────────────────────────────────────────────────────
async function clickConnectOnProfile(page) {
  // Primary: direct Connect button visible on profile header
  const directPatterns = [
    'button[aria-label*="Invite" i][aria-label*="connect" i]',
    'button[aria-label="Connect"]',
    'button:has-text("Connect")',
  ];

  for (const sel of directPatterns) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        console.log(`    ↳ Clicked Connect via: ${sel}`);
        await sleep(1500);
        return true;
      }
    } catch { /* try next */ }
  }

  // Secondary: Connect might be hidden inside the "More" / "…" overflow menu
  const morePatterns = [
    'button[aria-label="More actions"]',
    'button[aria-label*="More" i]',
    'button:has-text("More")',
  ];

  for (const sel of morePatterns) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        console.log(`    ↳ Opened More menu via: ${sel}`);
        await sleep(800);

        // Now look for Connect inside the dropdown
        const menuConnect = page.locator(
          'li:has-text("Connect"), [role="menuitem"]:has-text("Connect"), span:has-text("Connect")'
        ).first();
        if (await menuConnect.isVisible({ timeout: 2000 }).catch(() => false)) {
          await menuConnect.click();
          console.log('    ↳ Clicked Connect inside More menu');
          await sleep(1500);
          return true;
        }

        // Close the menu if Connect not found
        await page.keyboard.press('Escape');
        await sleep(400);
      }
    } catch { /* try next */ }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────
//  Check already connected / pending  (profile-page check)
// ─────────────────────────────────────────────────────────────────
async function isAlreadyConnectedOrPending(page) {
  try {
    const msg = page.locator(
      'button:has-text("Message"), a:has-text("Message"), ' +
      'button[aria-label*="Message" i], a[aria-label*="Message" i]'
    ).first();
    if (await msg.isVisible({ timeout: 1500 }).catch(() => false)) {
      return { yes: true, reason: 'Already connected (1st degree)' };
    }
    const pending = page.locator(
      'button:has-text("Pending"), button:has-text("Withdraw"), ' +
      'span:has-text("Pending"), [aria-label*="Withdraw" i]'
    ).first();
    if (await pending.isVisible({ timeout: 1500 }).catch(() => false)) {
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
 * @param {import('playwright').Page} page
 * @param {string} profileUrl  - full LinkedIn profile URL
 * @param {string} note        - AI-generated note (or '')
 * @param {boolean} dryRun     - if true, don't actually send
 * @param {string|null} inviteUrl - (ignored, kept for API compat)
 */
async function sendConnectionRequest(page, profileUrl, note = '', dryRun = false, inviteUrl = null) {
  if (dryRun) {
    return {
      sent: false, skipped: false,
      reason: `[DRY RUN] Would visit profile: ${profileUrl}` + (note ? ' with note' : ' without note'),
    };
  }

  // ── Step 1: Navigate to profile page ──────────────────────────
  console.log(`    ↳ Navigating to profile: ${profileUrl}`);
  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);
  } catch (e) {
    return { sent: false, skipped: true, reason: `Profile navigation failed: ${e.message.slice(0, 80)}` };
  }

  const currentUrl = page.url();
  if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
    return { sent: false, skipped: true, reason: 'LinkedIn redirected to login/checkpoint' };
  }

  // ── Step 2: Check already connected / pending ─────────────────
  const { yes, reason: connReason } = await isAlreadyConnectedOrPending(page);
  if (yes) return { sent: false, skipped: true, reason: connReason };

  // ── Step 3: Click the Connect button to open the modal ────────
  const connectClicked = await clickConnectOnProfile(page);
  if (!connectClicked) {
    return { sent: false, skipped: true, reason: 'Connect button not found on profile page' };
  }

  // ── Step 4: Handle the modal ──────────────────────────────────
  // The modal might show "How do you know X?" first (email gate)
  const emailField = page.locator('input[name="email"], input[type="email"]').first();
  if (await emailField.isVisible({ timeout: 2000 }).catch(() => false)) {
    // Close modal and skip — we can't connect without sharing email
    await page.keyboard.press('Escape');
    return { sent: false, skipped: true, reason: 'LinkedIn requires email to connect (outside network)' };
  }

  // ── Step 5: Send with note ────────────────────────────────────
  let sent = false;
  if (note && note.length > 0) {
    // Check if textarea is already visible
    const hasTextarea = await page.locator('textarea').isVisible({ timeout: 2000 }).catch(() => false);
    if (!hasTextarea) {
      // Click "Add a note" button inside the modal
      const addNotePatterns = [
        'button[aria-label="Add a note"]',
        'button:has-text("Add a note")',
        'button:has-text("Add note")',
        'button:has-text("Personalize")',
        'a:has-text("Add a note")',
      ];
      for (const sel of addNotePatterns) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
            await el.click();
            console.log(`    ↳ Clicked "Add a note" via: ${sel}`);
            await sleep(800);
            break;
          }
        } catch { /* try next */ }
      }
    }

    const typed = await fillNote(page, note);
    if (typed) {
      console.log('    ↳ Note typed — clicking Send...');
      sent = await clickSend(page);
    } else {
      console.log('    [WARN] Could not fill note textarea — attempting send without note');
    }
  }

  // ── Step 6: Send without note (fallback or no-note mode) ─────
  if (!sent) {
    console.log('    ↳ Attempting send without note...');
    sent = await clickSend(page);
  }

  if (sent) return { sent: true, skipped: false, reason: '' };
  return { sent: false, skipped: true, reason: 'Send button not found in modal' };
}

module.exports = { sendConnectionRequest };
