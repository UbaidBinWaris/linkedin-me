'use strict';
/**
 * dom-config.js — Centralized LinkedIn DOM Selector Registry
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  All CSS selectors, attributes, and encrypted tag patterns used    ║
 * ║  across the bot are catalogued here. When LinkedIn changes their   ║
 * ║  DOM, update THIS file instead of hunting through 5+ source files. ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Each group is an ordered array of selectors: primary first, fallbacks after.
 * Use `firstMatch(page, group)` to resolve the first visible element in order.
 *
 * Categories:
 *   ▸ FEED        — feed card containers, post detection
 *   ▸ SCROLL      — scrollable containers
 *   ▸ POST_META   — author info, post age, format detection
 *   ▸ COMMENT     — comment box, submit button, comment items
 *   ▸ LIKE        — like/reaction buttons
 *   ▸ CONNECT     — connection request flow (profile page)
 *   ▸ ENCRYPTED   — obfuscated componentkey / base64 patterns
 *   ▸ NAVIGATION  — feed links, login/checkpoint detection
 *   ▸ DIALOGS     — modal, error dialog selectors
 */

const DOM = {

  // ─── FEED CARD CONTAINERS ──────────────────────────────────────────
  // Selectors for identifying individual post cards in the feed.
  FEED: {
    // New layout: each post is a listitem with a componentkey ending in FeedType_*
    CARD_NEW_LAYOUT: '[role="listitem"][componentkey*="FeedType_"]',

    // Legacy layout: data attributes on post wrapper divs
    CARD_LEGACY: [
      '[data-urn*="activity"]',
      '[data-id*="activity"]',
      '[data-entity-urn]',
      '[data-view-name="feed-full-update"]',
    ],

    // Combined selector for Strategy C (data-urn walk) — all card patterns
    CARD_ALL: [
      '[data-urn*="activity"]',
      '[data-id*="activity"]',
      '[data-entity-urn]',
      '[data-view-name="feed-full-update"]',
      '[role="listitem"][componentkey*="FeedType_"]',
    ].join(','),

    // Anchor selectors for Strategy A+B (link walk)
    POST_ANCHORS: [
      'a[href*="/posts/"]',
      'a[href*="/feed/update/"]',
      'a[href*="ugcPost"]',
      'a[href*="activity"]',
    ],

    // URL patterns to SKIP when link-walking (non-post pages)
    SKIP_URL_PATTERN: /\/(company|jobs|learning|messaging|notifications|mynetwork|groups)\/?/,
  },

  // ─── SCROLL CONTAINERS ────────────────────────────────────────────
  // LinkedIn's feed may scroll inside a nested container, not window.
  SCROLL: {
    PRIORITY_CONTAINERS: [
      '.scaffold-layout__main',
      'div[class*="scaffold-finite-scroll"]',
      'div[class*="feed-container"]',
      'div[class*="artdeco-card"]',
      'main',
    ],

    // Generic fallback: scan all block elements for scrollable overflow
    FALLBACK_SCAN: 'div, main, section',

    // Minimum scroll difference (px) to consider an element scrollable
    MIN_SCROLL_DIFF: 200,
  },

  // ─── POST METADATA ────────────────────────────────────────────────
  // Selectors for extracting author info, post age, post format, etc.
  POST_META: {
    // Post age / timestamp subtitle (e.g., "2h • Edited")
    AGE_SUBTITLE: '.update-components-actor__sub-description',

    // Author profile links (used to extract profile URL)
    AUTHOR_LINKS: 'a[href*="/in/"], a[href*="/company/"]',

    // Post format detection — checked in order, first match wins
    FORMAT_DETECTORS: {
      poll:     '.update-components-poll',
      carousel: '.update-components-document',
      video:    'video, .update-components-video',
      image:    'img.update-components-image__image',
      // Default: 'text' if none match
    },

    // Comment items within a post card (for comment depth analysis)
    COMMENT_ITEMS: '.comments-comment-item',
    COMMENT_TEXT:  '.comments-comment-item__main-content',
    COMMENT_AUTHOR: '.comments-post-meta__name-text',
  },

  // ─── COMMENT BOX ────────────────────────────────────────────────
  // Selectors for finding and interacting with the comment input.
  COMMENT: {
    // Contenteditable editors — ordered by specificity
    EDITOR_SELECTORS: [
      '.ql-editor[contenteditable="true"]',
      '[contenteditable="true"][data-placeholder*="comment" i]',
      '[contenteditable="true"][data-placeholder*="Add a comment" i]',
      '[contenteditable="true"][aria-label*="comment" i]',
      '[contenteditable="true"][aria-label*="Add a comment" i]',
      '.comments-comment-box__form [contenteditable="true"]',
      '.comments-comment-texteditor [contenteditable="true"]',
    ],

    // Fallback: any contenteditable
    EDITOR_FALLBACK: '[contenteditable="true"]',

    // Buttons that open the comment box on a post card
    OPEN_BUTTON_PATTERNS: [
      'button[aria-label*="comment" i]',
      'button:has(svg[id*="comment"])',
      'button:has-text("Comment")',
    ],

    // Submit / post comment buttons (inside the comment editor area)
    SUBMIT_SELECTORS: [
      'button[aria-label="Comment"]',
      'button[aria-label="Post comment"]',
      'button[aria-label="Submit comment"]',
      'button.comments-comment-box__submit-button',
      'button.comment-button',
    ],

    // Text labels that identify a submit button (used in DOM walk)
    SUBMIT_LABELS: ['comment', 'post', 'post comment', 'submit'],

    // Minimum dimensions for a visible comment box (px)
    MIN_BOX_WIDTH: 50,
    MIN_BOX_HEIGHT: 10,
  },

  // ─── LIKE / REACTION BUTTONS ──────────────────────────────────────
  LIKE: {
    // aria-label and text patterns that identify the Like button
    LABEL_PATTERNS: ['react like', 'like', 'no reaction'],

    // Active state indicators (already liked)
    ACTIVE_INDICATORS: {
      ariaPressed: 'true',
      activeClass:  'react-button--active',
    },
  },

  // ─── CONNECTION REQUEST (Profile Page) ────────────────────────────
  CONNECT: {
    // Direct "Connect" buttons on profile header
    CONNECT_BUTTONS: [
      'button[aria-label*="Invite" i][aria-label*="connect" i]',
      'button[aria-label="Connect"]',
      'button:has-text("Connect")',
    ],

    // "More" / overflow menu buttons (Connect might be hidden here)
    MORE_MENU_BUTTONS: [
      'button[aria-label="More actions"]',
      'button[aria-label*="More" i]',
      'button:has-text("More")',
    ],

    // Connect option inside the overflow menu dropdown
    MENU_CONNECT_ITEM: 'li:has-text("Connect"), [role="menuitem"]:has-text("Connect"), span:has-text("Connect")',

    // "Add a note" button inside the connection modal
    ADD_NOTE_BUTTONS: [
      'button[aria-label="Add a note"]',
      'button:has-text("Add a note")',
      'button:has-text("Add note")',
      'button:has-text("Personalize")',
      'a:has-text("Add a note")',
    ],

    // Note textarea selectors (inside connection modal)
    NOTE_TEXTAREA: [
      'textarea#custom-message',
      'textarea[name="message"]',
      'textarea[aria-label*="note" i]',
      'textarea[aria-label*="message" i]',
      'textarea[placeholder*="note" i]',
      'textarea[placeholder*="Add" i]',
      'textarea',
    ].join(', '),

    // Send invitation buttons
    SEND_BUTTONS: [
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
    ],

    // Send button text keywords for DOM fallback search
    SEND_KEYWORDS: ['send invitation', 'send now', 'send without a note', 'send', 'done'],

    // Already connected / pending indicators
    ALREADY_CONNECTED: [
      'button:has-text("Message")',
      'a:has-text("Message")',
      'button[aria-label*="Message" i]',
      'a[aria-label*="Message" i]',
    ].join(', '),

    PENDING: [
      'button:has-text("Pending")',
      'button:has-text("Withdraw")',
      'span:has-text("Pending")',
      '[aria-label*="Withdraw" i]',
    ].join(', '),

    // Email gate (LinkedIn wants email to connect with distant users)
    EMAIL_GATE: 'input[name="email"], input[type="email"]',
  },

  // ─── ENCRYPTED / OBFUSCATED PATTERNS ──────────────────────────────
  // LinkedIn uses encoded componentkeys, proto-encoded URNs, etc.
  ENCRYPTED: {
    // componentkey format: "expanded<base64>FeedType_MAIN_FEED_RELEVANCE"
    COMPONENTKEY_EXPANDED_PATTERN: /^expanded([A-Za-z0-9_\-]{20,})FeedType_/,

    // Bare base64url componentkey (no "expanded" prefix, 30-60 chars)
    COMPONENTKEY_BARE_PATTERN: /^[A-Za-z0-9_\-]{30,60}$/,

    // UUID-format keys (action buttons, not posts) — skip these
    UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-/,

    // Plaintext URN embedded in innerHTML
    URN_PLAINTEXT_PATTERN: /urn:li:activity:(\d{15,})/,

    // URL-encoded URN in share hrefs
    URN_ENCODED_PATTERN: /urn%3Ali%3Aactivity%3A(\d{15,})/,

    // data-testid for comment lists (legacy): "<base64id>-commentLists"
    TESTID_COMMENT_PATTERN: /data-testid="([A-Za-z0-9_\-]+)-commentLists/,

    // Activity ID extraction from URN strings
    ACTIVITY_ID_PATTERN: /activity[:\-](\d+)/,

    // Valid LinkedIn snowflake activity ID range (approx 2022–2030)
    SNOWFLAKE_RANGE: {
      LOW:  6000000000000000000n,
      HIGH: 9999999999999999999n,
    },

    // Inner card componentkey selectors
    INNER_CARD_KEYS: '[componentkey]',
  },

  // ─── NAVIGATION ───────────────────────────────────────────────────
  NAVIGATION: {
    // Feed page links
    FEED_LINKS: [
      'a[href="/feed/"]',
      'a[href="https://www.linkedin.com/feed/"]',
    ],

    FEED_URL: 'https://www.linkedin.com/feed/',

    // URLs that indicate session expiry
    LOGIN_INDICATORS: ['/login', '/checkpoint'],

    // Post not displayable messages
    UNDISPLAYABLE_SIGNALS: [
      'This post cannot be displayed',
      'post cannot be displayed',
      'Content not available',
      "This content isn't available",
    ],
  },

  // ─── DIALOGS & MODALS ───────────────────────────────────────────
  DIALOGS: {
    // Error/alert dialogs that might block interaction
    ALERT_SELECTORS: '[role="alertdialog"], [role="dialog"]',

    // Error keywords in dialog text
    ERROR_KEYWORDS: ['error', 'unable', 'something went wrong'],
  },
};

// ─────────────────────────────────────────────────────────────────
//  HELPER — resolve first visible element from a selector group
// ─────────────────────────────────────────────────────────────────

/**
 * Try each selector in order, return the first Playwright Locator
 * that is currently visible on the page.
 *
 * @param {import('playwright').Page} page
 * @param {string[]} selectors - Array of CSS selectors (primary first)
 * @param {number}   timeout   - Visibility check timeout per selector (ms)
 * @returns {Promise<import('playwright').Locator|null>}
 */
async function firstMatch(page, selectors, timeout = 2000) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout }).catch(() => false)) {
        return loc;
      }
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Check if the current page URL indicates a login/checkpoint redirect.
 * @param {import('playwright').Page} page
 * @returns {boolean}
 */
function isSessionExpired(page) {
  const url = page.url();
  return DOM.NAVIGATION.LOGIN_INDICATORS.some((ind) => url.includes(ind));
}

/**
 * Check if the page body contains "post not displayable" signals.
 * @param {string} bodyText - document.body.innerText
 * @returns {boolean}
 */
function isUndisplayablePost(bodyText) {
  return DOM.NAVIGATION.UNDISPLAYABLE_SIGNALS.some((sig) => bodyText.includes(sig));
}

module.exports = { DOM, firstMatch, isSessionExpired, isUndisplayablePost };
