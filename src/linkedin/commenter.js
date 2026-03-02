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
    let liked = false;
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
          console.log('    👍 Post liked (via selector)');
          liked = true;
          await page.waitForTimeout(1200);
          break;
        }
      }
      
      // Fallback: evaluate the DOM to find any button with "Like" text and an outline icon
      if (!liked) {
        liked = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          for (const btn of btns) {
            const text = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
            const isPressed = btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('react-button--active');
            
            // If it's the like button and it's NOT already liked
            if ((text.toLowerCase() === 'like' || text.toLowerCase().includes('react like')) && !isPressed) {
              btn.click();
              return true;
            }
          }
          return false;
        });
        
        if (liked) {
          console.log('    👍 Post liked (via DOM fallback)');
          await page.waitForTimeout(1200);
        } else {
          console.log('    ⓘ Could not find an untoggled Like button (might already be liked).');
        }
      }
    } catch (e) {
      console.log(`    ⓘ Like failed to click gracefully: ${e.message.slice(0, 50)}`);
    }

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

    // ── 5. SUBMIT — click the blue "Comment" button ──
    // NOTE: Ctrl+Enter adds a NEWLINE in LinkedIn's Quill editor.
    //       We must click the visible "Comment" submit button instead.

    // Blur the text box first so the submit button becomes active
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await commentBox.click();  // re-focus so button stays active
    await page.waitForTimeout(500);

    // List of selectors that cover the blue "Comment" submit button
    // across different LinkedIn UI versions
    const submitSelectors = [
      // Exact label match
      'button[aria-label="Comment"]',
      'button[aria-label="Post comment"]',
      'button[aria-label="Submit comment"]',
      // Class-based (LinkedIn renders a specific class on the submit btn)
      'button.comments-comment-box__submit-button',
      'button.comment-button',
      // Generic: any visible <button> whose text is exactly "Comment" or "Post"
      'button:has-text("Comment")',
      'button:has-text("Post")',
    ];

    let submitted = false;
    for (const sel of submitSelectors) {
      try {
        const btn = page.locator(sel).last();  // last = innermost, most specific
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click();
          console.log(`    ✓ Submitted via button: ${sel}`);
          submitted = true;
          break;
        }
      } catch { /* try next selector */ }
    }

    // Last resort: find any button near the comment box that could be the submit
    if (!submitted) {
      console.log('    ⚠️  Named submit button not found — trying nearby button...');
      const found = await page.evaluate(() => {
        // Walk up from the Quill editor and look for a submit-type button
        const editors = document.querySelectorAll('.ql-editor, [contenteditable="true"]');
        for (const ed of editors) {
          let el = ed.parentElement;
          for (let i = 0; i < 10 && el; i++) {
            const btns = [...el.querySelectorAll('button')];
            for (const btn of btns) {
              const label = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
              if (label.includes('comment') || label.includes('post') || label.includes('submit')) {
                btn.click();
                return label;
              }
            }
            el = el.parentElement;
          }
        }
        return null;
      });
      if (found) {
        console.log(`    ✓ Clicked nearby button: "${found}"`);
        submitted = true;
      }
    }

    // Final fallback: plain Enter (NOT Ctrl+Enter which adds newline)
    if (!submitted) {
      console.log('    ⚠️  No submit button found — pressing Enter as last resort');
      await commentBox.click();
      await page.waitForTimeout(200);
      await page.keyboard.press('Enter');
    }

    // Wait for LinkedIn to process the submission
    await page.waitForTimeout(3500);

    // ── 6. Check for LinkedIn error dialogs ──
    const errorDismissed = await page.evaluate(() => {
      const dialogs = [
        ...document.querySelectorAll('[role="alertdialog"]'),
        ...document.querySelectorAll('[role="dialog"]'),
      ];
      for (const d of dialogs) {
        const txt = d.innerText || '';
        if (
          txt.toLowerCase().includes('error') ||
          txt.toLowerCase().includes('unable') ||
          txt.toLowerCase().includes('something went wrong')
        ) {
          const btn = d.querySelector('button');
          if (btn) btn.click();
          return true;
        }
      }
      return false;
    });

    if (errorDismissed) {
      console.log('    ⚠️  LinkedIn showed an error dialog after submission');
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

    // The page might not have refreshed yet — still treat as success
    // if we successfully clicked a submit button
    if (submitted) {
      console.log('    ✓ Submit button clicked (verification pending page refresh)');
      return true;
    }

    return false;

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
