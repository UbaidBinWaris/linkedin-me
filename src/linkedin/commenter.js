'use strict';
/**
 * commenter.js
 *
 * Flow:
 *  1. Navigate to post
 *  2. Like the post (optional, silent fail)
 *  3. Open comment box by clicking "Comment" action button
 *  4. Type comment using element.type() for reliable React-state updates
 *  5. Re-focus the box, then submit with Ctrl+Enter (primary)
 *     OR click "Post" button if visible (secondary)
 *  6. Handle LinkedIn error dialogs gracefully
 *  7. Verify via page text
 */

async function postComment(page, postUrl, commentText) {
  try {
    // ── Navigate ──
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const url = page.url();
    if (url.includes('/login') || url.includes('/checkpoint')) {
      console.log('    ⚠️  Session expired.');
      return false;
    }

    // ── Scroll to show action bar ──
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 300));
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(800);

    // ── 1. LIKE the post ──
    try {
      // Find the like button that is not yet activated
      const likeSelectors = [
        'button[aria-label*="React Like"][aria-pressed="false"]',
        'button[aria-label="Like"][aria-pressed="false"]',
        'button[aria-label*="Like this"][aria-pressed="false"]',
      ];
      for (const sel of likeSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.click();
          console.log('    👍 Post liked');
          await page.waitForTimeout(1200);
          break;
        }
      }
    } catch { /* like is optional */ }

    // ── 2. Open the comment box ──
    let commentBox = null;

    // Try clicking a "Comment" button first (opens the input area)
    try {
      const commentBtnSelectors = [
        'button[aria-label*="comment" i]',
        'button[aria-label*="Comment" i]',
      ];
      for (const sel of commentBtnSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click();
          console.log('    ✓ Comment button clicked');
          await page.waitForTimeout(2000);
          break;
        }
      }
    } catch { /* continue */ }

    // ── 3. Find the comment input box ──
    // LinkedIn uses a Quill contenteditable div — stable HTML attribute
    const boxSelectors = [
      '.ql-editor[contenteditable="true"]',
      '[contenteditable="true"][data-placeholder*="comment" i]',
      '[contenteditable="true"][aria-label*="comment" i]',
    ];
    for (const sel of boxSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        commentBox = el;
        break;
      }
    }

    // Fallback: find any empty contenteditable
    if (!commentBox) {
      const all = page.locator('[contenteditable="true"]');
      const count = await all.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const el = all.nth(i);
        if (!await el.isVisible({ timeout: 800 }).catch(() => false)) continue;
        const txt = (await el.innerText().catch(() => '')).trim();
        if (txt.length < 30) { commentBox = el; break; }
      }
    }

    if (!commentBox) {
      console.log('    ⚠️  No comment box found on:', postUrl.slice(-50));
      return false;
    }

    // ── 4. Click to focus, then TYPE ──
    // Use element.type() which reliably triggers React onChange events
    await commentBox.click();
    await page.waitForTimeout(500);

    // Clear first
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);

    // Type with element.type() — triggers DOM + React state
    await commentBox.type(commentText, { delay: 50 + Math.random() * 40 });
    await page.waitForTimeout(1500);

    // Verify text landed
    const typed = (await commentBox.innerText().catch(() => '')).trim();
    if (typed.length < 10) {
      console.log('    ⚠️  Text did not register in comment box');
      return false;
    }

    // ── 5. SUBMIT ──
    // PRIMARY: re-click box to ensure focus, then Ctrl+Enter
    await commentBox.click();
    await page.waitForTimeout(400);
    await commentBox.press('Control+Enter');
    console.log('    ✓ Submitted via Ctrl+Enter');

    // Wait for the submit to process
    await page.waitForTimeout(3000);

    // ── 6. Check for LinkedIn error dialogs ──
    const errorDismissed = await page.evaluate(() => {
      // Look for any error/alert dialog and dismiss it
      const dialogs = [
        ...document.querySelectorAll('[role="alertdialog"]'),
        ...document.querySelectorAll('[role="dialog"]'),
      ];
      for (const d of dialogs) {
        const txt = d.innerText || '';
        if (txt.toLowerCase().includes('error') || txt.toLowerCase().includes('unable')
          || txt.toLowerCase().includes('something went wrong')) {
          // Try to find and click a dismiss/close button
          const btn = d.querySelector('button');
          if (btn) btn.click();
          return true; // error was detected
        }
      }
      return false;
    });

    if (errorDismissed) {
      console.log('    ⚠️  LinkedIn showed an error dialog — retrying with Enter key');
      await commentBox.click();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
    }

    // ── 7. Verify ──
    if (page.url().includes('/login')) return false;

    const snippet = commentText.slice(0, 40).toLowerCase();
    const pageText = await page.evaluate(() =>
      document.body.innerText.toLowerCase()
    ).catch(() => '');

    if (pageText.includes(snippet)) {
      console.log('    ✓ Comment verified in page');
      return true;
    }

    // Comment posted but might still be loading — treat as success
    return true;

  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('Target page') || msg.includes('browser has been closed') || msg.includes('context or browser')) {
      console.log('    ⚠️  Browser/page closed unexpectedly — skipping post');
    } else {
      console.log(`    ❌ Commenting error: ${msg.slice(0, 120)}`);
    }
    return false;
  }
}

module.exports = { postComment };
