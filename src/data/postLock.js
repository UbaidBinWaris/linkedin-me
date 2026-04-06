'use strict';
/**
 * postLock.js — Production-grade duplicate-comment prevention
 *
 * Two independent layers ensure ONE post = ONE comment, forever:
 *
 *   Layer 1 — PostgreSQL (permanent truth across all runs / restarts)
 *   Layer 2 — Redis      (real-time mutex, blocks concurrent processes)
 *
 * Exact 6-step flow (caller is responsible for steps 4–6):
 *
 *   Step 1  Check PostgreSQL — postId already there? → SKIP
 *   Step 2  Acquire Redis lock (SET NX PX, atomic) — taken? → SKIP
 *   Step 3  Re-check PostgreSQL — race-condition safety net
 *   Step 4  [caller] Post the comment on LinkedIn
 *   Step 5  [caller] saveComment() — persist to PostgreSQL on success
 *   Step 6  [caller] releaseLock() — ALWAYS in a finally block
 *
 * Rules enforced here:
 *   • If ANY doubt → SKIP (never risk a second comment)
 *   • DB insert uses upsert — duplicate key = silent no-op (idempotent)
 *   • Redis TTL = 90 s — lock auto-expires if process crashes
 */

const prisma = require('./db');
const redis  = require('./redis');

// Redis lock configuration
const LOCK_PREFIX = 'lock:post:';
const LOCK_TTL_MS = 90_000; // 90 seconds — covers the full comment lifecycle

// ─────────────────────────────────────────────────────────────────
//  INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────

const lockKey = (postId) => `${LOCK_PREFIX}${postId}`;

/**
 * Step 1 / Step 3 — Query PostgreSQL.
 * Returns true if this postId has already been recorded.
 */
async function isAlreadyCommented(postId) {
  const row = await prisma.commentedPost.findUnique({
    where:  { postId },
    select: { id: true }, // minimal projection — we only need existence
  });
  return !!row;
}

/**
 * Step 2 — Atomic Redis lock using SET key value NX PX ttl.
 * NX = only set if Not eXists → true if we got the lock, false if taken.
 */
async function acquireLock(postId) {
  const result = await redis.set(lockKey(postId), '1', 'PX', LOCK_TTL_MS, 'NX');
  return result === 'OK';
}

// ─────────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────────

/**
 * acquirePostLock(postId)
 *
 * Executes Steps 1–3.  Call this BEFORE navigating to / interacting
 * with the post.
 *
 * Returns:
 *   { locked: true  }                   — proceed, you hold the lock
 *   { locked: false, reason: '...' }    — skip this post entirely
 */
async function acquirePostLock(postId) {
  // ── Step 1: PostgreSQL pre-check ──────────────────────────────
  if (await isAlreadyCommented(postId)) {
    return { locked: false, reason: 'already in database (step 1)' };
  }

  // ── Step 2: Acquire Redis lock (atomic NX) ────────────────────
  const gotLock = await acquireLock(postId);
  if (!gotLock) {
    return { locked: false, reason: 'redis lock held by another process (step 2)' };
  }

  // ── Step 3: PostgreSQL double-check ──────────────────────────
  // Handles the race window between step 1 and step 2 where another
  // worker could have inserted and released before our lock fired.
  if (await isAlreadyCommented(postId)) {
    await releaseLock(postId); // release lock we just acquired
    return { locked: false, reason: 'race condition: already in database (step 3)' };
  }

  return { locked: true };
}

/**
 * saveComment({ postId, postUrl, authorName, commentText })
 *
 * Step 5 — Persist a successfully-posted comment to PostgreSQL.
 *
 * Uses upsert so a duplicate-key error (caused by the tiny window
 * between step 3 re-check and the actual insert) is handled
 * gracefully — no exception, no retry needed.
 */
async function saveComment({ postId, postUrl, authorName, commentText }) {
  await prisma.commentedPost.upsert({
    where:  { postId },
    update: {},   // already exists → treat as success, touch nothing
    create: {
      postId,
      postUrl:     postUrl     || null,
      authorName:  authorName  || null,
      commentText: commentText || null,
    },
  });
}

/**
 * releaseLock(postId)
 *
 * Step 6 — Remove the Redis lock.
 * Always call this in a finally block so it runs even on errors.
 * Calling it when the key doesn't exist is a safe no-op.
 */
async function releaseLock(postId) {
  await redis.del(lockKey(postId));
}

/**
 * loadCommentedCache()
 *
 * Startup helper — loads all previously-commented post IDs and URLs
 * from PostgreSQL into in-memory Sets for fast O(1) lookups during
 * the feed evaluation loop.
 *
 * Returns: { ids: Set<string>, urls: Set<string> }
 */
async function loadCommentedCache() {
  const rows = await prisma.commentedPost.findMany({
    select: { postId: true, postUrl: true },
  });

  const ids  = new Set();
  const urls = new Set();

  for (const row of rows) {
    if (row.postId) ids.add(row.postId);
    if (row.postUrl) {
      const normalized = row.postUrl.replace(/\/+$/, '');
      urls.add(normalized);
    }
  }

  return { ids, urls };
}

/**
 * loadRecentAuthorsFromDb(days = 7)
 *
 * Returns a Set of normalized author names who received a comment
 * in the last `days` days.  Used for the per-author cooldown check.
 */
async function loadRecentAuthorsFromDb(days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.commentedPost.findMany({
    where:  { commentedAt: { gte: since } },
    select: { authorName: true },
  });

  const authors = new Set();
  for (const row of rows) {
    if (!row.authorName) continue;
    // Strip LinkedIn connection-degree suffixes ("• 2nd+", "· 1st", etc.)
    const normalized = row.authorName
      .replace(/\s*[•·]\s*(1st|2nd|3rd|\d+st|\d+nd|\d+rd|\d+th)\+?\s*$/i, '')
      .trim()
      .toLowerCase();
    if (normalized) authors.add(normalized);
  }

  return authors;
}

module.exports = {
  acquirePostLock,
  saveComment,
  releaseLock,
  loadCommentedCache,
  loadRecentAuthorsFromDb,
};
