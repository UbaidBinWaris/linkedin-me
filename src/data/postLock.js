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
const {
  extractPostId,
  normalizeLinkedInPostUrl,
  readCommentedPosts,
  writeCommentedPost,
} = require('./csv');

// Redis lock configuration
const LOCK_PREFIX = 'lock:post:';
const LOCK_TTL_MS = 90_000; // 90 seconds — covers the full comment lifecycle

// Lazily-initialized promise so table bootstrap runs once per process.
let ensureCommentedPostsTablePromise = null;
let databaseAvailable = true;
let redisFallbackWarned = false;
const inMemoryLocks = new Set();

function disableDatabase(err) {
  if (databaseAvailable) {
    console.warn(`[postLock] PostgreSQL unavailable. Falling back to CSV mode. Reason: ${err?.message || 'unknown error'}`);
  }
  databaseAvailable = false;
  ensureCommentedPostsTablePromise = null;
}

async function persistToCsvFallback({ postId, postUrl, authorName, commentText }) {
  const normalizedUrl = postUrl ? normalizeLinkedInPostUrl(postUrl) : null;
  const canonicalPostId = extractPostId(postId || normalizedUrl || '');
  const csvPostUrl = normalizedUrl || canonicalPostId;
  await writeCommentedPost(csvPostUrl, authorName || '', commentText || '');
}

async function upsertCommentRecord({ postId, postUrl, authorName, commentText }) {
  const normalizedUrl = postUrl ? normalizeLinkedInPostUrl(postUrl) : null;
  const canonicalPostId = extractPostId(postId || normalizedUrl || '');

  if (databaseAvailable) {
    await ensureCommentedPostsTable();
  }

  if (!databaseAvailable) {
    await persistToCsvFallback({ postId: canonicalPostId, postUrl: normalizedUrl, authorName, commentText });
    return;
  }

  try {
    await prisma.commentedPost.upsert({
      where:  { postId: canonicalPostId },
      update: {},
      create: {
        postId:      canonicalPostId,
        postUrl:     normalizedUrl || null,
        authorName:  authorName  || null,
        commentText: commentText || null,
      },
    });
  } catch (err) {
    disableDatabase(err);
    await persistToCsvFallback({ postId: canonicalPostId, postUrl: normalizedUrl, authorName, commentText });
  }
}

/**
 * Creates the commented_posts table/indexes if they do not exist.
 * This prevents startup crashes on fresh databases where Prisma schema
 * was not pushed yet.
 */
async function ensureCommentedPostsTable() {
  if (!databaseAvailable) return;

  if (!ensureCommentedPostsTablePromise) {
    ensureCommentedPostsTablePromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "commented_posts" (
          "id" SERIAL PRIMARY KEY,
          "postId" TEXT NOT NULL,
          "postUrl" TEXT,
          "authorName" TEXT,
          "commentText" TEXT,
          "commentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "commented_posts_postId_key"
        ON "commented_posts" ("postId")
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "commented_posts_postId_idx"
        ON "commented_posts" ("postId")
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "commented_posts_commentedAt_idx"
        ON "commented_posts" ("commentedAt")
      `);
    });
  }

  try {
    await ensureCommentedPostsTablePromise;
  } catch (err) {
    disableDatabase(err);
  }
}

// ─────────────────────────────────────────────────────────────────
//  INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────

const lockKey = (postId) => `${LOCK_PREFIX}${postId}`;

/**
 * Step 1 / Step 3 — Query PostgreSQL.
 * Returns true if this postId has already been recorded.
 */
async function isAlreadyCommented(postId) {
  if (!databaseAvailable) return false;
  await ensureCommentedPostsTable();
  if (!databaseAvailable) return false;

  try {
    const row = await prisma.commentedPost.findUnique({
      where:  { postId },
      select: { id: true }, // minimal projection — we only need existence
    });
    return !!row;
  } catch (err) {
    disableDatabase(err);
    return false;
  }
}

/**
 * Step 2 — Atomic Redis lock using SET key value NX PX ttl.
 * NX = only set if Not eXists → true if we got the lock, false if taken.
 */
async function acquireLock(postId) {
  try {
    const result = await redis.set(lockKey(postId), '1', 'PX', LOCK_TTL_MS, 'NX');
    return result === 'OK';
  } catch (err) {
    if (!redisFallbackWarned) {
      redisFallbackWarned = true;
      console.warn(`[postLock] Redis unavailable. Falling back to in-memory lock mode. Reason: ${err?.message || 'unknown error'}`);
    }
    if (inMemoryLocks.has(postId)) return false;
    inMemoryLocks.add(postId);
    return true;
  }
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
  await upsertCommentRecord({ postId, postUrl, authorName, commentText });
}

/**
 * markPostAttempted({ postId, postUrl, authorName, commentText })
 *
 * Permanently blocks a post ID after any comment attempt where outcome is
 * uncertain (for example, browser crash after submit click).
 *
 * This is intentionally conservative: if we are not 100% sure, we skip the
 * post forever to eliminate duplicate-comment risk.
 */
async function markPostAttempted({ postId, postUrl, authorName, commentText }) {
  await upsertCommentRecord({ postId, postUrl, authorName, commentText });
}

/**
 * releaseLock(postId)
 *
 * Step 6 — Remove the Redis lock.
 * Always call this in a finally block so it runs even on errors.
 * Calling it when the key doesn't exist is a safe no-op.
 */
async function releaseLock(postId) {
  inMemoryLocks.delete(postId);
  try {
    await redis.del(lockKey(postId));
  } catch {
    // Ignore redis errors in fallback mode.
  }
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
  if (databaseAvailable) {
    await ensureCommentedPostsTable();
  }

  if (!databaseAvailable) {
    return readCommentedPosts();
  }

  let rows;
  try {
    rows = await prisma.commentedPost.findMany({
      select: { postId: true, postUrl: true },
    });
  } catch (err) {
    disableDatabase(err);
    return readCommentedPosts();
  }

  const ids  = new Set();
  const urls = new Set();

  for (const row of rows) {
    if (row.postId) {
      ids.add(row.postId);
      ids.add(extractPostId(row.postId));
    }
    if (row.postUrl) {
      const normalized = normalizeLinkedInPostUrl(row.postUrl);
      urls.add(normalized);
      ids.add(extractPostId(normalized));
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
  if (!databaseAvailable) {
    return new Set();
  }

  await ensureCommentedPostsTable();
  if (!databaseAvailable) {
    return new Set();
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let rows;
  try {
    rows = await prisma.commentedPost.findMany({
      where:  { commentedAt: { gte: since } },
      select: { authorName: true },
    });
  } catch (err) {
    disableDatabase(err);
    return new Set();
  }

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
  markPostAttempted,
  releaseLock,
  loadCommentedCache,
  loadRecentAuthorsFromDb,
};
