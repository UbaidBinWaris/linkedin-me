'use strict';
/** Plain-Promise sleep — page.waitForTimeout removed in modern Playwright */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * commenter.js
 *
 * Strategy (feed-first, no navigation):
 *  1. Stay on the feed — find the post card by decoding its componentkey
 *     and matching the activity ID from postUrl.
 *  2. Scroll the card into view.
 *  3. Like the post (optional, silent fail).
 *  4. Click the "Comment" button on the card to open its inline comment box.
 *  5. Type comment, submit, verify.
 *
 * Falls back to page.goto() only for posts that have no card in the feed
 * (e.g. direct /in/ profile post pages).
 */

// ─────────────────────────────────────────────────────────────────
//  Decode LinkedIn componentkey → activity ID (same logic as feed.js)
// ─────────────────────────────────────────────────────────────────
function decodeUrnBase64(b64url) {
  try {
    const b64    = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const raw    = atob ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
    const len    = raw.length;
    const LO = 6000000000000000000n;
    const HI = 9999999999999999999n;
    for (let s = 0; s < Math.min(len, 12); s++) {
      let id = 0n, shift = 0n;
      for (let i = s; i < len; i++) {
        const b = BigInt(raw.charCodeAt(i));
        id |= (b & 0x7fn) << shift;
        shift += 7n;
        if (!(b & 0x80n)) break;
        if (shift > 70n) { id = 0n; break; }
      }
      if (id >= LO && id <= HI) return id.toString();
    }
    for (let o = 0; o + 8 <= len; o++) {
      let le = 0n;
      for (let i = 7; i >= 0; i--) le = (le << 8n) | BigInt(raw.charCodeAt(o + i));
      if (le >= LO && le <= HI) return le.toString();
      let be = 0n;
      for (let i = 0; i < 8; i++) be = (be << 8n) | BigInt(raw.charCodeAt(o + i));
      if (be >= LO && be <= HI) return be.toString();
    }
    return null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────
//  Find scroll container (same approach as feed.js)
// ─────────────────────────────────────────────────────────────────
async function getScrollContainer(page) {
  return page.evaluate(() => {
    // Returns true/false — actual scrolling done inside evaluate
    let best = null, bestDiff = 200;
    document.querySelectorAll('div, main, section').forEach((el) => {
      const diff = el.scrollHeight - el.clientHeight;
      if (diff <= bestDiff) return;
      if (['auto', 'scroll'].includes(window.getComputedStyle(el).overflowY)) {
        best = el; bestDiff = diff;
      }
    });
    return best ? best.tagName + '|' + best.className.slice(0, 60) : 'window';
  });
}

// ─────────────────────────────────────────────────────────────────
//  Scroll feed container by px
// ─────────────────────────────────────────────────────────────────
async function scrollContainer(page, px) {
  await page.evaluate((amount) => {
    let best = null, bestDiff = 200;
    document.querySelectorAll('div, main, section').forEach((el) => {
      const diff = el.scrollHeight - el.clientHeight;
      if (diff <= bestDiff) return;
      if (['auto', 'scroll'].includes(window.getComputedStyle(el).overflowY)) {
        best = el; bestDiff = diff;
      }
    });
    if (best) best.scrollBy(0, amount);
    else window.scrollBy(0, amount);
  }, px);
}

// ─────────────────────────────────────────────────────────────────
//  Like + Comment helpers (operate on a card element inside evaluate)
// ─────────────────────────────────────────────────────────────────

async function likeCard(page, cardIndex) {
  return page.evaluate((idx) => {
    const cards = document.querySelectorAll('[role="listitem"][componentkey*="FeedType_"]');
    const card = cards[idx];
    if (!card) return false;
    const btns = [...card.querySelectorAll('button')];
    for (const btn of btns) {
      const label = (btn.getAttribute('aria-label') || btn.innerText || '').toLowerCase();
      const pressed = btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('react-button--active');
      if (!pressed && (label.includes('react like') || label === 'like' || label.includes('no reaction'))) {
        btn.click();
        return true;
      }
    }
    return false;
  }, cardIndex);
}

async function clickCommentButton(page, cardIndex) {
  const card = page.locator('[role="listitem"][componentkey*="FeedType_"]').nth(cardIndex);

  const editorSelectors = [
    '.ql-editor[contenteditable="true"]',
    '[contenteditable="true"][data-placeholder*="comment" i]',
    '[contenteditable="true"][data-placeholder*="Add a comment" i]',
    '[contenteditable="true"][aria-label*="comment" i]',
    '.comments-comment-box__form [contenteditable="true"]',
    '.comments-comment-texteditor [contenteditable="true"]',
  ].join(', ');

  const isComposerOpen = async () => {
    return card.locator(editorSelectors).first().isVisible({ timeout: 700 }).catch(() => false);
  };

  // Already open in this card.
  if (await isComposerOpen()) return true;

  const clickNativeButtonInCard = async () => {
    const candidates = [
      card.locator('button[aria-label*="comment" i]'),
      card.locator('button').filter({ hasText: 'Comment' }),
      card.locator('button:has(svg[id*="comment"])'),
      card.locator('button:has(use[href*="comment"])'),
    ];

    for (const group of candidates) {
      const btn = group.first();
      if (await btn.isVisible({ timeout: 600 }).catch(() => false)) {
        await btn.click({ timeout: 1500 }).catch(() => {});
        return true;
      }
    }
    return false;
  };

  const clickWrapperFallback = async () => {
    return page.evaluate((idx) => {
      const cards = document.querySelectorAll('[role="listitem"][componentkey*="FeedType_"]');
      const cardEl = cards[idx];
      if (!cardEl) return false;
      const btns = [...cardEl.querySelectorAll('button')];
      let target = null;
      for (const btn of btns) {
        const label = (btn.getAttribute('aria-label') || btn.innerText || '').toLowerCase();
        if (label.includes('comment') || btn.querySelector('svg[id*="comment"], use[href*="comment"]')) {
          target = btn;
          break;
        }
      }
      if (!target) return false;
      target.click();
      const wrap = target.closest('div[role="button"], span, div, li');
      if (wrap) wrap.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    }, cardIndex).catch(() => false);
  };

  // Retry a few times because LinkedIn sometimes requires a second click
  // (button + blue wrapper activation) before the composer appears.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const clicked = await clickNativeButtonInCard();
    if (clicked) {
      await sleep(500);
      if (await isComposerOpen()) return true;
    }

    await clickWrapperFallback();
    await sleep(500);
    if (await isComposerOpen()) return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────
//  Card-scoped composer helpers (prevents typing into stale editors)
// ─────────────────────────────────────────────────────────────────

async function typeAndSubmitOnCard(page, cardIndex, commentText) {
  const card = page.locator('[role="listitem"][componentkey*="FeedType_"]').nth(cardIndex);

  const editorSelectors = [
    '.ql-editor[contenteditable="true"]',
    '[contenteditable="true"][data-placeholder*="comment" i]',
    '[contenteditable="true"][data-placeholder*="Add a comment" i]',
    '[contenteditable="true"][aria-label*="comment" i]',
    '.comments-comment-box__form [contenteditable="true"]',
    '.comments-comment-texteditor [contenteditable="true"]',
  ].join(', ');

  // Wait briefly for the inline composer to appear in THIS card.
  const editor = card.locator(editorSelectors).first();
  const visible = await editor.isVisible({ timeout: 3000 }).catch(() => false);
  if (!visible) return false;

  await editor.click();
  await sleep(200);
  await page.keyboard.press('Control+a');
  await sleep(100);
  await page.keyboard.press('Delete');
  await sleep(120);
  await editor.type(commentText, { delay: 45 + Math.random() * 40 });
  await sleep(900);

  const typed = (await editor.innerText().catch(() => '')).trim();
  if (typed.length < 10) {
    console.log('    ⚠️  Text did not register in scoped card editor');
    return false;
  }

  // Click submit from the active editor container, not the feed action bar.
  const submitted = await page.evaluate((idx) => {
    const cards = document.querySelectorAll('[role="listitem"][componentkey*="FeedType_"]');
    const cardEl = cards[idx];
    if (!cardEl) return false;

    const editors = [...cardEl.querySelectorAll('[contenteditable="true"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 30 && r.height > 10;
      });
    if (!editors.length) return false;

    const editor = editors[editors.length - 1];
    let container = editor.parentElement;
    for (let i = 0; i < 14 && container; i++) {
      const btns = [...container.querySelectorAll('button')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 10 && r.height > 10 && b.offsetParent !== null;
      });

      for (const btn of btns) {
        const label = (btn.getAttribute('aria-label') || btn.innerText || '').trim().toLowerCase();
        const hasEditorInside = !!btn.querySelector('[contenteditable="true"]');
        if (hasEditorInside) continue;

        // Strictly allow composer submit buttons only.
        if (
          label === 'comment' ||
          label === 'post comment' ||
          label === 'submit comment' ||
          label === 'post'
        ) {
          btn.click();
          return label || true;
        }
      }
      container = container.parentElement;
    }
    return false;
  }, cardIndex).catch(() => false);

  if (submitted) {
    console.log('    ✓ Submitted (composer-scoped button)');
    return true;
  }

  // Final scoped fallback: Enter while focused in this card editor.
  await editor.click();
  await sleep(120);
  await page.keyboard.press('Enter');
  console.log('    ⚠️  Submitted via Enter fallback (scoped card editor)');
  return true;
}

async function verifyCommentPostedOnCard(page, cardIndex, commentText) {
  const snippet = (commentText || '').slice(0, 40).toLowerCase();
  if (!snippet) return false;

  for (let i = 0; i < 4; i++) {
    await sleep(900);

    const state = await page.evaluate(({ idx, needle }) => {
      const cards = document.querySelectorAll('[role="listitem"][componentkey*="FeedType_"]');
      const card = cards[idx];
      if (!card) return { hasInEditor: false, hasOutsideEditor: false, editorTextLen: 0 };

      const editors = [...card.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]')];
      const editorText = editors.map((el) => (el.innerText || el.value || '')).join(' ').toLowerCase();
      const hasInEditor = editorText.includes(needle);

      // Clone and remove editors to avoid counting draft text as "posted".
      const clone = card.cloneNode(true);
      clone.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]').forEach((el) => el.remove());
      const visibleText = (clone.innerText || '').toLowerCase();
      const hasOutsideEditor = visibleText.includes(needle);

      // Strong signal: newly added comment appears inside comment list area.
      const commentListsText = [...card.querySelectorAll('[data-testid*="commentLists" i], [componentkey*="commentLists" i], [componentkey*="commentsSection" i]')]
        .map((el) => (el.innerText || '').toLowerCase())
        .join(' ');
      const hasInCommentList = commentListsText.includes(needle);

      return { hasInEditor, hasOutsideEditor, hasInCommentList, editorTextLen: editorText.trim().length };
    }, { idx: cardIndex, needle: snippet }).catch(() => ({ hasInEditor: false, hasOutsideEditor: false, editorTextLen: 0 }));

    // If text is still in editor, treat as not posted.
    if (state.hasInEditor) return false;

    if (state.hasInCommentList || state.hasOutsideEditor) return true;

    // If composer cleared and no outside text yet, allow one more retry cycle.
    if (!state.hasInEditor && state.editorTextLen === 0 && i >= 2) return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────
//  Find the feed card index for a given activity ID
//  Scrolls up to 3 extra batches to find it if not yet rendered.
// ─────────────────────────────────────────────────────────────────
async function findCardIndex(page, activityId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const idx = await page.evaluate((targetId) => {
      const LO = 6000000000000000000n;
      const HI = 9999999999999999999n;
      function decode(b64url) {
        try {
          const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
          const pad = b64 + '='.repeat((4 - b64.length % 4) % 4);
          const raw = atob(pad); const len = raw.length;
          for (let s = 0; s < Math.min(len, 12); s++) {
            let id = 0n, shift = 0n;
            for (let i = s; i < len; i++) {
              const b = BigInt(raw.charCodeAt(i));
              id |= (b & 0x7fn) << shift; shift += 7n;
              if (!(b & 0x80n)) break; if (shift > 70n) { id = 0n; break; }
            }
            if (id >= LO && id <= HI) return id.toString();
          }
          for (let o = 0; o + 8 <= len; o++) {
            let le = 0n; for (let i = 7; i >= 0; i--) le = (le << 8n) | BigInt(raw.charCodeAt(o + i));
            if (le >= LO && le <= HI) return le.toString();
            let be = 0n; for (let i = 0; i < 8; i++) be = (be << 8n) | BigInt(raw.charCodeAt(o + i));
            if (be >= LO && be <= HI) return be.toString();
          }
          return null;
        } catch { return null; }
      }
      const cards = document.querySelectorAll('[role="listitem"][componentkey*="FeedType_"]');
      for (let i = 0; i < cards.length; i++) {
        const ck = cards[i].getAttribute('componentkey') || '';
        const m = ck.match(/^expanded([A-Za-z0-9_\-]{20,})FeedType_/);
        if (m && decode(m[1]) === targetId) return i;
      }
      return -1;
    }, activityId);

    if (idx !== -1) return idx;
    if (attempt < 3) {
      // Scroll to load more cards and wait
      await scrollContainer(page, 900);
      await sleep(1200);
    }
  }
  return -1;
}

// ─────────────────────────────────────────────────────────────────
//  Scroll a specific card into the viewport
// ─────────────────────────────────────────────────────────────────
async function scrollCardIntoView(page, cardIndex) {
  await page.evaluate((idx) => {
    const cards = document.querySelectorAll('[role="listitem"][componentkey*="FeedType_"]');
    if (cards[idx]) cards[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, cardIndex);
  await sleep(800);
}

// ─────────────────────────────────────────────────────────────────
//  Find the comment input box and type + submit
// ─────────────────────────────────────────────────────────────────
async function typeAndSubmit(page, commentText) {
  const boxSelectors = [
    '.ql-editor[contenteditable="true"]',
    '[contenteditable="true"][data-placeholder*="comment" i]',
    '[contenteditable="true"][data-placeholder*="Add a comment" i]',
    '[contenteditable="true"][aria-label*="comment" i]',
    '[contenteditable="true"][aria-label*="Add a comment" i]',
    '.comments-comment-box__form [contenteditable="true"]',
    '.comments-comment-texteditor [contenteditable="true"]',
  ];

  let commentBox = null;
  for (const sel of boxSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      commentBox = el; break;
    }
  }
  // Generic fallback: any empty contenteditable
  if (!commentBox) {
    const all = page.locator('[contenteditable="true"]');
    const count = await all.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const el = all.nth(i);
      if (!await el.isVisible({ timeout: 600 }).catch(() => false)) continue;
      const txt = (await el.innerText().catch(() => '')).trim();
      if (txt.length < 30) { commentBox = el; break; }
    }
  }
  if (!commentBox) return false;

  await commentBox.click();
  await sleep(400);
  await page.keyboard.press('Control+a');
  await sleep(100);
  await page.keyboard.press('Delete');
  await sleep(150);
  await commentBox.type(commentText, { delay: 45 + Math.random() * 40 });
  await sleep(1200);

  const typed = (await commentBox.innerText().catch(() => '')).trim();
  if (typed.length < 10) {
    console.log('    ⚠️  Text did not register in comment box');
    return false;
  }

  // Re-focus the box so LinkedIn enables the submit button
  await commentBox.click();
  await sleep(500);

  // ── Scoped submit: walk UP from the editor to find its container panel,
  //    then find the submit button WITHIN that panel only.
  //    This avoids accidentally clicking the action-bar "Comment" button
  //    which has the same text but is in a different DOM subtree.
  let submitted = false;

  submitted = await page.evaluate(() => {
    // Find the active contenteditable
    const editors = [...document.querySelectorAll('[contenteditable="true"]')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 50 && r.height > 10 && el.innerText.trim().length > 0;
      });
    if (!editors.length) return false;
    const editor = editors[editors.length - 1]; // last visible = the open comment box

    // Walk UP to find the comment editor container (max 12 levels)
    let container = editor.parentElement;
    for (let i = 0; i < 12 && container; i++) {
      // Look for a submit-type button INSIDE this container
      const btns = [...container.querySelectorAll('button')];
      for (const btn of btns) {
        if (!btn.offsetParent) continue; // skip hidden
        const rect = btn.getBoundingClientRect();
        if (rect.width < 10) continue; // skip invisible
        const label = (btn.innerText || btn.getAttribute('aria-label') || '').trim().toLowerCase();
        // Must be a submit-ish button but NOT an emoji/image/toolbar icon
        if (
          (label === 'comment' || label === 'post' || label === 'post comment' || label === 'submit') &&
          // Exclude action-bar buttons which contain the editor as a descendant
          !btn.contains(editor) &&
          // Exclude buttons that are ancestors of the editor
          !btn.querySelector('[contenteditable]')
        ) {
          btn.click();
          return btn.innerText.trim() || btn.getAttribute('aria-label') || 'submit';
        }
      }
      container = container.parentElement;
    }
    return false;
  });

  if (submitted) {
    console.log(`    ✓ Submitted (scoped DOM): "${submitted}"`);
    submitted = true;
  }

  // Fallback: aria-label selectors scoped tightly
  if (!submitted) {
    const ariaSelectors = [
      'button[aria-label="Comment"]',
      'button[aria-label="Post comment"]',
      'button[aria-label="Submit comment"]',
      'button.comments-comment-box__submit-button',
      'button.comment-button',
    ];
    for (const sel of ariaSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.click();
          console.log(`    ✓ Submitted via aria: ${sel}`);
          submitted = true; break;
        }
      } catch { /* try next */ }
    }
  }

  // Last resort: Tab to the submit button then press Space/Enter
  if (!submitted) {
    console.log('    ⚠️  Named submit not found — trying Tab+Enter');
    await commentBox.click();
    await sleep(200);
    // Tab past emoji/image buttons to reach the submit button
    for (let t = 0; t < 4; t++) {
      await page.keyboard.press('Tab');
      await sleep(150);
      // Check if a button with "comment" text is focused
      const focusedLabel = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? (el.innerText || el.getAttribute('aria-label') || '').toLowerCase() : '';
      }).catch(() => '');
      if (focusedLabel.includes('comment') || focusedLabel.includes('post')) {
        await page.keyboard.press('Space');
        console.log(`    ✓ Submitted via Tab+Space (focused: "${focusedLabel}")`);
        submitted = true;
        break;
      }
    }
  }

  if (!submitted) {
    // Absolute last resort: plain Enter key
    await commentBox.click();
    await sleep(200);
    await page.keyboard.press('Enter');
    console.log('    ⚠️  Pressed Enter as last resort');
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────
//  MAIN — postComment
// ─────────────────────────────────────────────────────────────────
async function postComment(page, postUrl, commentText) {
  try {
    const activityMatch = postUrl.match(/activity[:\-_](\d{15,})/);
    const activityId    = activityMatch ? activityMatch[1] : null;

    // ── Ensure we are on the feed ──
    if (!page.url().includes('linkedin.com/feed')) {
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);
    }
    if (page.url().includes('/login') || page.url().includes('/checkpoint')) {
      console.log('    ⚠️  Session expired.');
      return false;
    }

    // ── Strategy 1: act on the feed card directly (no navigation) ──
    if (activityId) {
      console.log(`    🔍 Looking for feed card (activity:${activityId})...`);
      const cardIdx = await findCardIndex(page, activityId);

      if (cardIdx !== -1) {
        console.log(`    ✓ Found card at index ${cardIdx} — staying on feed`);
        await scrollCardIntoView(page, cardIdx);

        // Dismiss any previously open inline composer from older cards.
        // LinkedIn sometimes keeps stale drafts open across feed interactions.
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(120);
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(120);
        await page.evaluate((idx) => {
          const cards = document.querySelectorAll('[role="listitem"][componentkey*="FeedType_"]');
          cards[idx]?.scrollIntoView({ behavior: 'instant', block: 'center' });
        }, cardIdx).catch(() => {});
        await sleep(180);

        // Like
        const liked = await likeCard(page, cardIdx);
        if (liked) { console.log('    👍 Post liked'); await sleep(900); }
        else        { console.log('    ⓘ Like skipped (already liked or not found)'); }

        // Open comment box on the card
        const opened = await clickCommentButton(page, cardIdx);
        if (opened) { console.log('    ✓ Comment button clicked'); }
        else        { console.log('    ⚠️  Comment button not found on card'); }

        // Give the UI time to react — then check if LinkedIn navigated away from feed
        await sleep(2000);
        const urlAfterClick = page.url();
        const stillOnFeed   = urlAfterClick.includes('linkedin.com/feed');

        if (!stillOnFeed) {
          // LinkedIn navigated to the post detail page — handle it there
          console.log(`    ↳ Comment button caused navigation → handling on post page`);

          // Verify it navigated to the CORRECT post (not a cached/previous page)
          if (activityId && !urlAfterClick.includes(activityId)) {
            console.log(`    ↳ Wrong post page detected — navigating to correct URL`);
            await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          }
          await sleep(1500);

          // Detect undisplayable posts
          const bodyTxt = await page.evaluate(() => document.body.innerText).catch(() => '');
          if (
            bodyTxt.includes('This post cannot be displayed') ||
            bodyTxt.includes('post cannot be displayed') ||
            bodyTxt.includes('Content not available')
          ) {
            console.log('    ⚠️  Post not displayable on post page — skipping');
            return false;
          }

          // Scroll to show the action bar
          for (let i = 0; i < 3; i++) { await scrollContainer(page, 300); await sleep(300); }
          await sleep(500);

          // Open comment box on the post page (click Comment action button)
          const commentBtnSelectors = [
            'button[aria-label*="comment" i]',
            'button:has(svg[id*="comment"])',
          ];
          for (const sel of commentBtnSelectors) {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
              await btn.click();
              console.log('    ✓ Comment button clicked (post page)');
              await sleep(2000);
              break;
            }
          }
        }

        // Type + submit in THIS card only (prevents stale-editor cross-posting).
        const submitted = await typeAndSubmitOnCard(page, cardIdx, commentText);
        // On feed cards, do NOT fall back to global composer selection,
        // otherwise we may type into a stale editor from a previous post.
        const submittedFinal = stillOnFeed
          ? submitted
          : (submitted || await typeAndSubmit(page, commentText));
        if (!submittedFinal) {
          console.log('    ⚠️  No comment box found');
          return false;
        }

        const ok = await verifyCommentPostedOnCard(page, cardIdx, commentText);
        if (ok) {
          console.log('    ✓ Comment verified in current card');
          return true;
        }
        console.log('    ⚠️  Comment not verified on current card (likely still draft)');
        return false;
      }

      console.log(`    ⚠️  Card not found in feed — falling back to page navigation`);
    }

    // ── Strategy 2: navigate to post page (fallback for off-feed posts) ──
    console.log(`    → Navigating to: ${postUrl.slice(-60)}`);
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3500);

    if (page.url().includes('/login') || page.url().includes('/checkpoint')) {
      console.log('    ⚠️  Session expired.');
      return false;
    }

    // Detect posts that LinkedIn cannot display (private/deleted/restricted)
    const pageBodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (
      pageBodyText.includes('This post cannot be displayed') ||
      pageBodyText.includes('post cannot be displayed') ||
      pageBodyText.includes('Content not available') ||
      pageBodyText.includes('This content isn\'t available')
    ) {
      console.log('    ⚠️  Post not displayable (private/deleted) — skipping');
      return false;
    }

    // Scroll to action bar
    for (let i = 0; i < 4; i++) {
      await scrollContainer(page, 300);
      await sleep(350);
    }
    await sleep(600);

    // ── Like (page-level, fallback path) ──
    const liked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      for (const btn of btns) {
        const label = (btn.getAttribute('aria-label') || btn.innerText || '').toLowerCase();
        const pressed = btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('react-button--active');
        if (!pressed && (label.includes('react like') || label === 'like' || label.includes('no reaction'))) {
          btn.click(); return true;
        }
      }
      return false;
    });
    if (liked) { console.log('    👍 Post liked'); await sleep(900); }
    else        { console.log('    ⓘ Like skipped (already liked or not found)'); }

    // ── Open comment box (page-level) ──
    const commentBtnSelectors = [
      'button[aria-label*="comment" i]',
      'button:has(svg[id*="comment"])',
      'button:has-text("Comment")',
    ];
    for (const sel of commentBtnSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1800 }).catch(() => false)) {
        await btn.click();
        console.log('    ✓ Comment button clicked');
        await sleep(2200);
        break;
      }
    }

    // ── Type + submit via shared helper ──
    const submitted = await typeAndSubmit(page, commentText);
    if (!submitted) {
      console.log('    ⚠️  No comment box found on:', postUrl.slice(-50));
      return false;
    }

    await sleep(3500);

    // Dismiss any LinkedIn error dialogs
    await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[role="alertdialog"],[role="dialog"]')];
      for (const d of dialogs) {
        const txt = (d.innerText || '').toLowerCase();
        if (txt.includes('error') || txt.includes('unable') || txt.includes('something went wrong')) {
          const btn = d.querySelector('button'); if (btn) btn.click();
        }
      }
    }).catch(() => {});

    if (page.url().includes('/login')) return false;

    const snippet  = commentText.slice(0, 40).toLowerCase();
    const pageText = await page.evaluate(() => document.body.innerText.toLowerCase()).catch(() => '');
    if (pageText.includes(snippet)) { console.log('    ✓ Comment verified in page'); return true; }
    console.log('    ✓ Submitted (verification: text not yet visible in DOM)');
    return true;

  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('browser has been closed') || msg.includes('Target page, context or browser has been closed')) {
      console.log('    ⚠️  Browser was closed unexpectedly — skipping post');
    } else if (msg.includes('Execution context was destroyed') || msg.includes('context was destroyed')) {
      console.log('    ⚠️  Page navigated mid-action — skipping post');
    } else {
      console.log(`    ❌ Commenting error: ${msg.slice(0, 120)}`);
    }
    return false;
  }
}

module.exports = { postComment };

