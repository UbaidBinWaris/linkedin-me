'use strict';

/**
 * filters.js — Modular post & author filtering
 *
 * This module decides:
 *   1. Whether to SKIP an author (OTW / job-seeker / student)
 *   2. Whether a post is INTERESTING enough to comment on
 *
 * All signals are grouped into named lists so you can easily
 * tune them without touching bot logic.
 */

// ─────────────────────────────────────────────────────────────────
//  AUTHOR SKIP SIGNALS
//  Any of these phrases in authorName, authorHeadline, or the
//  first ~300 chars of postText → skip the author.
// ─────────────────────────────────────────────────────────────────

/** Signals that author is actively "Open To Work" */
const OTW_SIGNALS = [
  'open to work',
  'open to opportunities',
  '#opentowork',
  'open for work',
  '#openforwork',
  'actively seeking',
  'actively looking',
  'available for hire',
  'available for opportunities',
  'job seeker',
  '#jobseeker',
  'seeking employment',
  'seeking a role',
  'seeking new role',
  'looking for a job',
  'looking for work',
  'looking for opportunities',
  'looking for my next',
  'in search of',
  'open for job',
  '#hireme',
  '#lookingforjob',
];

/** Signals that author is a student or very junior */
const STUDENT_SIGNALS = [
  'student',
  'undergraduate',
  'undergrad',
  'bsc student',
  'btech student',
  'cs student',
  'computer science student',
  'engineering student',
  'mba student',
  'intern',
  'internship',
  'fresher',
  'fresh graduate',
  'recent graduate',
  'new graduate',
  'entry level',
  'entry-level',
  'junior developer',
  'aspiring developer',
  'aspiring engineer',
  'aspiring professional',
  'aspiring data scientist',
  'aspiring software engineer',
  'career break',
  'career switch',
  'career transition',
  'bootcamp',
  'coding bootcamp',
  'self-taught',
  'self taught',
  'learning to code',
  'learning programming',
  '1 year of experience',
  '2 years of experience',
];

/** Signals that the POST is a job ad or recruitment pitch */
const JOB_POST_SIGNALS = [
  'we\'re hiring',
  "we're hiring",
  'we are hiring',
  'now hiring',
  'join our team',
  'apply now',
  'apply here',
  'send your cv',
  'send your resume',
  'dm me your cv',
  'dm me for details',
  'link in comments to apply',
  'job opening',
  'job opportunity',
  'job vacancy',
  'open position',
  'open role',
  'currently hiring',
  '#hiring',
  '#jobopening',
  '#vacancy',
  '#recruitment',
  '#recruiting',
];

// ─────────────────────────────────────────────────────────────────
//  INTERESTING POST SIGNALS
//  Posts are interesting if they contain at least one GOOD_SIGNAL
//  and don't hit the BAD_SIGNAL threshold.
// ─────────────────────────────────────────────────────────────────

/** Topics that suggest a post worth engaging with */
const GOOD_SIGNALS = [
  // Tech & Dev
  'startup', 'founder', 'cto', 'ceo', 'saas', 'product',
  'engineering', 'developer', 'software', 'ai', 'machine learning',
  'llm', 'gpt', 'nextjs', 'react', 'node', 'devops', 'kubernetes',
  'microservices', 'architecture', 'system design', 'backend', 'frontend',
  'api', 'database', 'open source', 'side project', 'shipped',
  // Leadership & Growth
  'leadership', 'team', 'culture', 'management', 'mentor',
  'lesson', 'learned', 'mistake', 'failure', 'growth', 'scale',
  'strategy', 'decision', 'insight', 'opinion', 'unpopular opinion',
  'controversial', 'experience', 'story',
  // Business
  'revenue', 'mrr', 'arr', 'fundraising', 'vc', 'bootstrap',
  'launch', 'mvp', 'iteration', 'product market fit', 'customer',
];

/** Topics that suggest a boring / low-value post */
const BAD_SIGNALS = [
  'motivational quote',
  'agree?',
  'thoughts?',
  'repost if',
  'share if you agree',
  'double tap',
  'humble',
  'blessed',
  'grateful for',
];

// ─────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────

function lc(...strings) {
  return strings.filter(Boolean).join(' ').toLowerCase();
}

function hasAny(text, signals) {
  return signals.some((s) => text.includes(s));
}

// ─────────────────────────────────────────────────────────────────
//  EXPORTED FILTER FUNCTIONS
// ─────────────────────────────────────────────────────────────────

/**
 * Returns true if author appears to be "Open To Work".
 * Checks headline + first part of post text.
 */
function isOpenToWork(authorName = '', authorHeadline = '', postText = '') {
  const haystack = lc(authorName, authorHeadline, postText.slice(0, 400));
  return hasAny(haystack, OTW_SIGNALS);
}

/**
 * Returns true if author signals are student / very junior.
 */
function isStudent(authorName = '', authorHeadline = '', postText = '') {
  const haystack = lc(authorName, authorHeadline, postText.slice(0, 400));
  return hasAny(haystack, STUDENT_SIGNALS);
}

/**
 * Returns true if the post itself is a job advertisement / hiring post.
 */
function isJobPost(postText = '') {
  const haystack = lc('', '', postText.slice(0, 800));
  return hasAny(haystack, JOB_POST_SIGNALS);
}

/**
 * Master "skip this author / post?" check.
 * Returns { skip: true|false, reason: string }
 */
function shouldSkip(authorName = '', authorHeadline = '', postText = '') {
  if (isOpenToWork(authorName, authorHeadline, postText)) {
    return { skip: true, reason: 'Author is Open To Work' };
  }
  if (isStudent(authorName, authorHeadline, postText)) {
    return { skip: true, reason: 'Author appears to be a student / junior' };
  }
  if (isJobPost(postText)) {
    return { skip: true, reason: 'Post is a job advertisement' };
  }
  return { skip: false, reason: '' };
}

/**
 * Scores a post's interest level using keyword heuristics.
 * Returns { score: 0-100, interesting: bool }
 * Used as a fast pre-filter BEFORE calling the AI scorer.
 */
function heuristicInterestScore(postText = '') {
  const t = lc('', '', postText);
  let score = 0;

  // Minimum length requirements
  if (postText.length < 100)  return { score: 0, interesting: false };
  if (postText.length > 300)  score += 15;
  if (postText.length > 600)  score += 10;
  if (postText.length > 1000) score += 5;

  // Good signal matches
  for (const kw of GOOD_SIGNALS) {
    if (t.includes(kw)) score += 4;
  }

  // Bad signal penalty
  for (const kw of BAD_SIGNALS) {
    if (t.includes(kw)) score -= 10;
  }

  score = Math.min(100, Math.max(0, score));
  return { score, interesting: score >= 20 };
}

module.exports = {
  isOpenToWork,
  isStudent,
  isJobPost,
  shouldSkip,
  heuristicInterestScore,
  // Export signal lists so advanced users can extend them
  OTW_SIGNALS,
  STUDENT_SIGNALS,
  JOB_POST_SIGNALS,
  GOOD_SIGNALS,
  BAD_SIGNALS,
};
