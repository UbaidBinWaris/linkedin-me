'use strict';

/**
 * filters.js — Modular post & author filtering + composite weighted scoring
 *
 * EXPORTS:
 *   shouldSkip(authorName, authorHeadline, postText)
 *     → { skip, reason }
 *
 *   compositeScore(post)
 *     → { total, breakdown }   (0-100 final score)
 *
 *   Signal arrays (OTW_SIGNALS, etc.) — export so bot.js can log them
 */

// ─────────────────────────────────────────────────────────────────
//  SKIP SIGNALS — Authors / posts to completely ignore
// ─────────────────────────────────────────────────────────────────

const AI_SPAM_SIGNALS = [
  'in today’s fast paced world', 'in todays fast paced world', 'in today\'s fast-paced world',
  'as we navigate', 'it is important to', 'here are 5 lessons', 'here are 3 lessons',
  'delve into', 'let\'s dive in'
];

const ENGAGEMENT_POD_SIGNALS = [
  'nice one bro', 'dm sent', 'check inbox', 'interested', 'great post',
  'thanks for sharing', 'commenting for reach'
];

const STORY_ARC_SIGNALS = [
  'started', 'failed', 'learned', 'realized', 'after 3 years', 'in 2020',
  'in 2021', 'in 2022', 'we almost', 'i almost'
];

const OTW_SIGNALS = [
  'open to work', 'open to opportunities', '#opentowork', 'open for work',
  '#openforwork', 'actively seeking', 'actively looking', 'available for hire',
  'available for opportunities', 'job seeker', '#jobseeker', 'seeking employment',
  'seeking a role', 'seeking new role', 'looking for a job', 'looking for work',
  'looking for opportunities', 'looking for my next', 'in search of',
  'open for job', '#hireme', '#lookingforjob',
];

const STUDENT_SIGNALS = [
  'student', 'undergraduate', 'undergrad', 'bsc student', 'btech student',
  'cs student', 'computer science student', 'engineering student', 'mba student',
  'intern', 'internship', 'fresher', 'fresh graduate', 'recent graduate',
  'new graduate', 'entry level', 'entry-level', 'junior developer',
  'aspiring developer', 'aspiring engineer', 'aspiring professional',
  'aspiring data scientist', 'aspiring software engineer', 'career break',
  'career switch', 'career transition', 'bootcamp', 'coding bootcamp',
  'self-taught', 'self taught', 'learning to code', 'learning programming',
];

const JOB_POST_SIGNALS = [
  "we're hiring", 'we are hiring', 'now hiring', 'join our team', 'apply now',
  'apply here', 'send your cv', 'send your resume', 'dm me your cv',
  'link in comments to apply', 'job opening', 'job opportunity', 'job vacancy',
  'open position', 'open role', 'currently hiring', '#hiring', '#jobopening',
  '#vacancy', '#recruitment', '#recruiting',
];

/** Posts about grief / tragedy — never automate empathy */
const SENTIMENT_SKIP_SIGNALS = [
  'lost my', 'passed away', 'rest in peace', 'rip ', 'we lost',
  'diagnosed with', 'cancer', 'funeral', 'grieving', 'in mourning',
  'laid off today', 'just got laid off', 'just lost my job',
  'health crisis', 'mental breakdown', 'suicide', 'depression',
  'struggling mentally', 'lost someone', 'tragedy', 'devastating news',
];

// ─────────────────────────────────────────────────────────────────
//  SCORING SIGNALS
// ─────────────────────────────────────────────────────────────────

/** Niche-specific signals — match YOUR expertise cluster */
const NICHE_SIGNALS = [
  // Backend / infra
  'nodejs', 'node.js', 'backend', 'api design', 'rest api', 'graphql',
  'microservices', 'distributed systems', 'system design', 'architecture',
  'kubernetes', 'docker', 'devops', 'ci/cd', 'deployment',
  // Frontend / full-stack
  'nextjs', 'next.js', 'react', 'typescript', 'full stack', 'fullstack',
  // AI / automation
  'ai workflow', 'automation', 'n8n', 'llm', 'ai agent', 'openai', 'gemini',
  'langchain', 'rag', 'prompt engineering',
  // General high-value
  'saas', 'startup', 'founder', 'cto', 'ceo', 'product', 'engineering',
  'developer experience', 'open source', 'shipped', 'launched',
];

/** Author seniority keywords that appear in headlines */
const SENIORITY_SIGNALS = [
  ['founder', 25], ['co-founder', 25], ['ceo', 25], ['cto', 22],
  ['chief', 20], ['vp ', 20], ['vice president', 20], ['partner', 18],
  ['director', 15], ['head of', 15], ['principal', 14],
  ['staff engineer', 14], ['staff software', 14],
  ['engineering manager', 12], ['product manager', 12], ['sr.', 10],
  ['senior', 10], ['lead ', 10],
];

/** Good content patterns — strong post signals */
const GOOD_SIGNALS = [
  'startup', 'founder', 'product', 'engineering', 'developer', 'software',
  'ai', 'machine learning', 'devops', 'architecture', 'design', 'backend',
  'leadership', 'team', 'lesson', 'learned', 'mistake', 'failure',
  'growth', 'scale', 'strategy', 'decision', 'insight', 'opinion',
  'built', 'shipped', 'launched', 'revenue', 'mrr', 'bootstrap',
  'open source', 'automation', 'workflow', 'experience', 'story',
];

/** Low-value content patterns */
const BAD_SIGNALS = [
  'motivational quote', 'agree?', 'share if you agree',
  'repost if', 'double tap', 'humble', 'blessed', 'grateful for',
  'like if', 'comment below', 'what do you think?',
];

// ─────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────

function lc(...parts) {
  return parts.filter(Boolean).join(' ').toLowerCase();
}
function hasAny(text, signals) {
  return signals.some((s) => {
    const kw = Array.isArray(s) ? s[0] : s;
    return text.includes(kw);
  });
}
function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

// ─────────────────────────────────────────────────────────────────
//  SKIP CHECKS
// ─────────────────────────────────────────────────────────────────

function isOpenToWork(authorName = '', authorHeadline = '', postText = '') {
  return hasAny(lc(authorName, authorHeadline, postText.slice(0, 400)), OTW_SIGNALS);
}
function isStudent(authorName = '', authorHeadline = '', postText = '') {
  return hasAny(lc(authorName, authorHeadline, postText.slice(0, 400)), STUDENT_SIGNALS);
}
function isJobPost(postText = '') {
  return hasAny(lc('', '', postText.slice(0, 800)), JOB_POST_SIGNALS);
}
function isSentimentPost(postText = '') {
  return hasAny(lc('', '', postText.slice(0, 600)), SENTIMENT_SKIP_SIGNALS);
}

/**
 * Master skip check. Returns { skip: bool, reason: string }
 */
function shouldSkip(authorName = '', authorHeadline = '', postText = '') {
  if (isOpenToWork(authorName, authorHeadline, postText))
    return { skip: true, reason: 'Author is Open To Work' };
  if (isStudent(authorName, authorHeadline, postText))
    return { skip: true, reason: 'Author appears to be a student / junior' };
  if (isJobPost(postText))
    return { skip: true, reason: 'Post is a job advertisement' };
  if (isSentimentPost(postText))
    return { skip: true, reason: 'Post is about grief / tragedy — skip out of respect' };
  return { skip: false, reason: '' };
}

// ─────────────────────────────────────────────────────────────────
//  COMPOSITE SCORING
//
//  score = (heuristicScore  * 0.40)
//        + (engagementScore * 0.25)
//        + (seniorityScore  * 0.15)
//        + (nicheScore      * 0.10)
//        + (recencyScore    * 0.10)
//
//  All sub-scores are normalized 0-100.
// ─────────────────────────────────────────────────────────────────

/**
 * Heuristic content score — 0-100
 * Keyword matching from GOOD/BAD lists, story arcs, and penalties.
 */
function calcHeuristicScore(postText = '', commentsData = []) {
  const t = lc('', '', postText);
  if (postText.length < 100) return 0;

  let score = 0;
  if (postText.length > 300)  score += 15;
  if (postText.length > 600)  score += 10;
  if (postText.length > 1000) score += 5;

  for (const kw of GOOD_SIGNALS) if (t.includes(kw)) score += 5;
  for (const kw of BAD_SIGNALS)  if (t.includes(kw)) score -= 10;
  
  // Story Arc Boost
  let storyWordCount = 0;
  for (const kw of STORY_ARC_SIGNALS) if (t.includes(kw)) storyWordCount++;
  if (storyWordCount >= 2) score += 20;

  // AI Content Penalty
  for (const kw of AI_SPAM_SIGNALS) if (t.includes(kw)) score -= 20;

  // Engagement Pod Penalty (Check comments)
  if (commentsData && commentsData.length > 0) {
    let podHits = 0;
    const commentsText = commentsData.join(' ').toLowerCase();
    for (const kw of ENGAGEMENT_POD_SIGNALS) if (commentsText.includes(kw)) podHits++;
    if (podHits >= 2) score -= 30; // Heavy penalty if obvious pod thread
  }

  return clamp(score, 0, 100);
}

/**
 * Engagement score — log-scaled, 0-100
 * Optimal range: 20-500 reactions.
 * >10k reactions → post is viral, noisy, low visibility for you.
 */
function calcEngagementScore(reactionCount = 0, commentCount = 0) {
  // Too few = nobody cares; too many = spam cluster risk
  if (reactionCount < 5)      return 10;  // very few reactions, still might be new
  if (reactionCount > 10000)  return 15;  // viral — avoid
  if (commentCount > 200)     return 10;  // too crowded

  // Log-scaled 0-100
  const reactionScore = Math.log10(reactionCount + 1) * 20;

  // Sweet spot bonus (20-500 reactions = max visibility for your comment)
  const sweetSpot = reactionCount >= 20 && reactionCount <= 500 ? 20 : 0;

  return clamp(reactionScore + sweetSpot, 0, 100);
}

/**
 * Seniority score — 0-100 (Capped at 80 to prevent automatic dominance)
 * Based on keywords in authorHeadline.
 */
function calcSeniorityScore(authorHeadline = '') {
  const hl = authorHeadline.toLowerCase();
  
  // Follower Proxy Boosts (Creator, Newsletter, Investor, Angel)
  let proxyBoost = 0;
  if (hl.includes('creator') || hl.includes('newsletter')) proxyBoost += 15;
  if (hl.includes('angel') || hl.includes('investor')) proxyBoost += 10;

  let rawScore = 20; // unknown headline = neutral
  for (const [kw, pts] of SENIORITY_SIGNALS) {
    if (hl.includes(kw)) {
      rawScore = pts * 4;
      break; // take highest matching (array ordered descending)
    }
  }
  
  return clamp(Math.min(rawScore, 80) + proxyBoost, 0, 100);
}

/**
 * Niche relevance score — 0-100
 * How closely the post matches YOUR expertise area.
 */
function calcNicheScore(postText = '') {
  const t = lc('', '', postText);
  let hits = 0;
  for (const kw of NICHE_SIGNALS) if (t.includes(kw)) hits++;
  return clamp(hits * 15, 0, 100);
}

/**
 * Recency score — 0-100
 * Based on scrape-time recency (we don't have actual post timestamps
 * without navigating to each post, so we use position as a proxy:
 * posts earlier in the feed are generally more recent).
 * @param {number} positionIndex - 0 = first post found (most recent)
 * @param {number} totalPosts - total posts found
 */
function calcRecencyScore(positionIndex = 0, totalPosts = 10, postAge = '') {
  let score = 50;
  if (totalPosts > 0) {
    const ratio = 1 - (positionIndex / totalPosts);
    score = ratio * 100;
  }
  
  // Extra boost if "1h" or "minutes" is detected in exact postAge string
  const lowerAge = (postAge || '').toLowerCase();
  if (lowerAge.includes('m •') || lowerAge.includes('1h •')) {
    score += 20;
  }
  
  return clamp(score, 0, 100);
}

/**
 * Comment Visibility Potential Score — 0-100
 * Measures how likely your comment is to be seen.
 */
function calcCommentVisibilityScore(commentCount = 0) {
  if (commentCount <= 5) return 90;
  if (commentCount <= 20) return 100;
  if (commentCount <= 50) return 75;
  if (commentCount <= 100) return 50;
  if (commentCount <= 200) return 25;
  return 10;
}

/**
 * Master composite scorer.
 *
 * @param {object} post metadata object
 * @returns {{ total: number, breakdown: object, shouldComment: boolean }}
 */
function compositeScore(post) {
  const {
    postText       = '',
    authorHeadline = '',
    reactionCount  = 0,
    commentCount   = 0,
    positionIndex  = 0,
    totalPosts     = 10,
    isConnection   = false,
    postFormat     = 'text',
    commentsData   = [],
    authorReplied  = false,
    postAge        = '',
  } = post;

  let heuristic  = calcHeuristicScore(postText, commentsData);
  let engagement = calcEngagementScore(reactionCount, commentCount);
  const seniority  = calcSeniorityScore(authorHeadline);
  const niche      = calcNicheScore(postText);
  let recency    = calcRecencyScore(positionIndex, totalPosts, postAge);
  const visibility = calcCommentVisibilityScore(commentCount);

  // Apply contextual modifiers to heuristic score
  
  // Early Traction Boost
  if (reactionCount >= 15 && reactionCount <= 150 && commentCount <= 40) {
    heuristic += 15;
  }
  
  // Network Proximity Boost
  if (isConnection) {
    heuristic += 15;
  }
  
  // Post Format Classification
  if (postFormat === 'text') heuristic += 10;
  if (postFormat === 'image') heuristic += 5;
  if (postFormat === 'poll') heuristic -= 10;
  
  // Comment Depth Opportunity
  if (commentsData.length > 0) {
    const avgLen = commentsData.reduce((acc, c) => acc + c.length, 0) / commentsData.length;
    if (avgLen < 50) heuristic += 20; // Shallow thread, good chance to stand out
  }
  
  // Author Reply Probability
  if (authorReplied) {
    heuristic += 20;
  }
  
  // Time adjustments (we don't know local time precisely, but postAge helps)
  // We boost if momentum is high
  const lowerAge = postAge.toLowerCase();
  if ((lowerAge.includes('m •') || lowerAge.includes('1h •')) && reactionCount >= 50) {
    engagement += 20; 
  }

  // Ensure bounds
  heuristic = clamp(heuristic, 0, 100);
  engagement = clamp(engagement, 0, 100);

  // New Weighted Math Formula (Strategically aligned for ROI)
  //  score = (heuristicScore  * 0.35)
  //        + (engagementScore * 0.15)
  //        + (visibilityScore * 0.15)
  //        + (seniorityScore  * 0.15)
  //        + (nicheScore      * 0.10)
  //        + (recencyScore    * 0.10)
  const total = (heuristic  * 0.35)
              + (engagement * 0.15)
              + (visibility * 0.15)
              + (seniority  * 0.15)
              + (niche      * 0.10)
              + (recency    * 0.10);

  return {
    total: Math.round(clamp(total, 0, 100)),
    breakdown: {
      heuristic:  Math.round(heuristic),
      engagement: Math.round(engagement),
      seniority:  Math.round(seniority),
      niche:      Math.round(niche),
      recency:    Math.round(recency),
      visibility: Math.round(visibility),
    },
    shouldComment: total >= 30,
  };
}

module.exports = {
  shouldSkip,
  compositeScore,
  // Individual sub-scorers (for testing / custom use)
  calcHeuristicScore,
  calcEngagementScore,
  calcSeniorityScore,
  calcNicheScore,
  calcCommentVisibilityScore,
  // Signal lists (for extension)
  OTW_SIGNALS, STUDENT_SIGNALS, JOB_POST_SIGNALS,
  SENTIMENT_SKIP_SIGNALS, NICHE_SIGNALS, SENIORITY_SIGNALS,
  GOOD_SIGNALS, BAD_SIGNALS,
};
