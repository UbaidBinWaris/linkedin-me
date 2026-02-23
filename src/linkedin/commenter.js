'use strict';
const { randomDelay } = require('../browser/session');

/**
 * Posts a comment on a LinkedIn post.
 *
 * @param {import('playwright').Page} page
 * @param {string} postUrl - The full URL of the LinkedIn post
 * @param {string} commentText - The text to post as a comment
 * @returns {Promise<boolean>} - true if comment was posted successfully
 */
async function postComment(page, postUrl, commentText) {
  try {
    // Navigate to the post
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000 + Math.random() * 1000);

    // Check we didn't get redirected to login
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
      console.log('    ⚠️  Session expired while trying to comment.');
      return false;
    }

    // ── Step 1: Click the "Comment" button to open the comment box ──
    const commentButtonSelectors = [
      'button[aria-label*="comment" i]',
      'button[aria-label*="Comment" i]',
      '.comment-button',
      '[data-control-name="comment"]',
      'button.comments-comment-box-comment__submit-button',
      '.feed-shared-social-action-bar__action-btn:has-text("Comment")',
      'button:has-text("Comment")',
    ];

    let commentButtonClicked = false;
    for (const selector of commentButtonSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click();
          commentButtonClicked = true;
          await page.waitForTimeout(1500);
          break;
        }
      } catch {
        // try next selector
      }
    }

    // ── Step 2: Find the comment text area ──
    const commentBoxSelectors = [
      '.ql-editor[contenteditable="true"]',
      '[contenteditable="true"][data-placeholder*="comment" i]',
      '[contenteditable="true"][data-placeholder*="Comment" i]',
      '.comments-comment-box__text-editor [contenteditable="true"]',
      '.comments-comment-list__comment-box [contenteditable="true"]',
      '[contenteditable="true"]',
    ];

    let commentBox = null;
    for (const selector of commentBoxSelectors) {
      try {
        commentBox = await page.$(selector);
        if (commentBox) {
          const isVisible = await commentBox.isVisible();
          if (isVisible) break;
          commentBox = null;
        }
      } catch {
        // try next
      }
    }

    if (!commentBox) {
      // Try clicking the placeholder text area if visible
      const placeholder = await page.$('.comments-comment-box__form');
      if (placeholder) {
        await placeholder.click();
        await page.waitForTimeout(1000);
        for (const selector of commentBoxSelectors) {
          commentBox = await page.$(selector);
          if (commentBox && (await commentBox.isVisible())) break;
          commentBox = null;
        }
      }
    }

    if (!commentBox) {
      console.log('    ⚠️  Could not find comment box on post:', postUrl);
      return false;
    }

    // ── Step 3: Click the box to focus it ──
    await commentBox.click();
    await page.waitForTimeout(800);

    // ── Step 4: Type the comment character by character (human-like) ──
    for (const char of commentText) {
      await commentBox.type(char, { delay: 30 + Math.random() * 60 });
    }
    await page.waitForTimeout(1000 + Math.random() * 500);

    // ── Step 5: Submit with Ctrl+Enter or click Submit button ──
    let submitted = false;

    // Try the submit button first
    const submitSelectors = [
      'button.comments-comment-box__submit-button',
      'button[type="submit"]:has-text("Post")',
      '.comments-comment-box__form button[type="submit"]',
      'button[aria-label*="Post comment" i]',
    ];

    for (const selector of submitSelectors) {
      try {
        const submitBtn = await page.$(selector);
        if (submitBtn && (await submitBtn.isVisible()) && (await submitBtn.isEnabled())) {
          await submitBtn.click();
          submitted = true;
          break;
        }
      } catch {
        // try next
      }
    }

    // Fallback: Ctrl+Enter
    if (!submitted) {
      await commentBox.press('Control+Enter');
      submitted = true;
    }

    // Wait for the comment to appear / confirm submission
    await page.waitForTimeout(3000);

    // Verify the comment was posted by briefly checking URL/page state
    const finalUrl = page.url();
    if (finalUrl.includes('/login')) {
      return false;
    }

    return true;
  } catch (err) {
    console.log(`    ❌ Commenting failed: ${err.message}`);
    return false;
  }
}

module.exports = { postComment };
