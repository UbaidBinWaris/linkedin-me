'use strict';
/**
 * bannedPhrases.js — Prevent generic/repetitive comment openers
 *
 * Based on analysis of 90+ past bot comments, these openers appear
 * too frequently and fail to drive profile clicks. The AI prompt
 * forbids them, but this module acts as a hard safety net.
 *
 * EXPORTS:
 *   BANNED_OPENERS       — Array of phrases that must not START a comment
 *   BANNED_ANYWHERE      — Array of overused filler phrases to flag anywhere
 *   hasBannedOpener(text) — Returns { banned: bool, phrase: string }
 *   cleanComment(text)   — Strips banned opener if present, returns cleaned text
 *   getBannedPromptBlock() — Returns a formatted string to inject into AI prompts
 */

// ─────────────────────────────────────────────────────────────────
//  BANNED OPENERS — phrases that must NEVER start a comment
//  (case-insensitive, matched against first 60 chars)
// ─────────────────────────────────────────────────────────────────

const BANNED_OPENERS = [
  // Empty validation
  'love this',
  'so true',
  'spot on',
  'great post',
  'great insight',
  'great point',
  'great to see',
  'well said',
  'well put',
  'couldn\'t agree more',
  'totally agree',
  'absolutely agree',
  'absolutely',
  'exactly',
  'this is so true',
  'this resonates',
  'this is spot on',
  'this is great',
  'this is amazing',
  'this is fantastic',
  'this is powerful',
  'this is gold',
  'this hits home',
  'so accurate',
  'perfectly said',
  'brilliantly put',
  'beautifully said',
  'nailed it',

  // Filler starters
  'interesting point',
  'interesting take',
  'interesting perspective',
  'fascinating insight',
  'fascinating take',
  'fascinating to see',
  'impressive',
  'inspiring',
  'inspiring to see',
  'congrats',
  'congratulations',

  // AI-isms
  'as someone who',
  'as a developer',
  'as a full stack',
  'as an engineer',
  'i completely agree',
  'i couldn\'t agree more',
  'what a great',
  'what an insightful',
];

// ─────────────────────────────────────────────────────────────────
//  BANNED ANYWHERE — overused filler found in past comments
// ─────────────────────────────────────────────────────────────────

const BANNED_ANYWHERE = [
  'game changer',
  'game-changer',
  'reminds me of',
  'this mirrors',
  'the real challenge was',
  'the real test',
  'truly impactful',
  'looking forward to',
  'it\'s crucial',
  'it\'s essential',
  'it\'s fascinating',
  'can\'t wait to see',
];

// ─────────────────────────────────────────────────────────────────
//  CHECK — does the comment start with a banned phrase?
// ─────────────────────────────────────────────────────────────────

/**
 * @param {string} text - The generated comment
 * @returns {{ banned: boolean, phrase: string }}
 */
function hasBannedOpener(text) {
  if (!text) return { banned: false, phrase: '' };
  const lower = text.toLowerCase().trim();

  for (const phrase of BANNED_OPENERS) {
    if (lower.startsWith(phrase)) {
      return { banned: true, phrase };
    }
  }
  return { banned: false, phrase: '' };
}

/**
 * Count how many BANNED_ANYWHERE phrases appear in the text.
 * @param {string} text
 * @returns {{ count: number, phrases: string[] }}
 */
function countBannedFillers(text) {
  if (!text) return { count: 0, phrases: [] };
  const lower = text.toLowerCase();
  const found = BANNED_ANYWHERE.filter((p) => lower.includes(p));
  return { count: found.length, phrases: found };
}

// ─────────────────────────────────────────────────────────────────
//  CLEAN — strip banned opener from comment if present
// ─────────────────────────────────────────────────────────────────

/**
 * If the comment starts with a banned opener, strip it and return the rest.
 * Handles cases like "Love this. The real insight is..." → "The real insight is..."
 * Also handles "Love this — the..." → "The..."
 *
 * @param {string} text
 * @returns {string} - Cleaned comment (or original if no banned opener found)
 */
function cleanComment(text) {
  if (!text) return text;

  const { banned, phrase } = hasBannedOpener(text);
  if (!banned) return text;

  // Remove the banned opener
  let cleaned = text.slice(phrase.length).trim();

  // Strip leading punctuation: ". ", "! ", ", ", "— ", "- ", ": "
  cleaned = cleaned.replace(/^[.!,:\-—–]\s*/, '').trim();

  // Capitalize first letter
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  // If nothing meaningful remains, return original (better than empty)
  if (cleaned.length < 20) return text;

  return cleaned;
}

// ─────────────────────────────────────────────────────────────────
//  PROMPT BLOCK — formatted string to inject into AI prompts
// ─────────────────────────────────────────────────────────────────

/**
 * Returns a formatted string listing banned phrases for AI prompt injection.
 */
function getBannedPromptBlock() {
  const openers = BANNED_OPENERS.slice(0, 20).map((p) => `"${p}"`).join(', ');
  const fillers = BANNED_ANYWHERE.map((p) => `"${p}"`).join(', ');

  return `
BANNED OPENERS — your comment must NEVER start with any of these:
${openers}

OVERUSED FILLERS — avoid these phrases entirely:
${fillers}

If you catch yourself writing any of these, REWRITE the comment with a fresh angle.`;
}

module.exports = {
  BANNED_OPENERS,
  BANNED_ANYWHERE,
  hasBannedOpener,
  countBannedFillers,
  cleanComment,
  getBannedPromptBlock,
};
