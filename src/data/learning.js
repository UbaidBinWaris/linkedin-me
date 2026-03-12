'use strict';
/**
 * learning.js — Comment Performance Tracking & Self-Learning Data Layer
 *
 * Tracks every comment with metadata so the bot can learn which
 * styles, types, and strategies perform best over time.
 *
 * Data is stored in data/comment_performance.json
 *
 * EXPORTS:
 *   logCommentPerformance(entry)  — Save a comment + metadata
 *   getPerformanceData()          — Load all tracked comments
 *   getStyleStats()               — Aggregate stats by comment style
 *   getTypeStats()                — Aggregate stats by comment type
 *   getCountryStats()             — Aggregate stats by author country/region
 *   getBestAngles(n)             — Top N performing comment angles
 */

const fs   = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../../data/comment_performance.json');

// ─────────────────────────────────────────────────────────────────
//  ENSURE FILE EXISTS
// ─────────────────────────────────────────────────────────────────

function ensureFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ comments: [], stats: { totalComments: 0 } }, null, 2));
  }
}

// ─────────────────────────────────────────────────────────────────
//  READ / WRITE
// ─────────────────────────────────────────────────────────────────

function readData() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { comments: [], stats: { totalComments: 0 } };
  }
}

function writeData(data) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────────────────────────────
//  LOG A COMMENT
// ─────────────────────────────────────────────────────────────────

/**
 * Save a comment interaction with full metadata.
 *
 * @param {object} entry
 * @param {string} entry.postUrl         - URL of the commented post
 * @param {string} entry.authorName      - Post author's name
 * @param {string} entry.authorHeadline  - Post author's headline
 * @param {string} entry.comment         - The comment text posted
 * @param {string} entry.style           - Comment style used (e.g., 'experiential')
 * @param {string} entry.type            - Comment type used (e.g., 'micro_insight')
 * @param {number} entry.score           - Post composite score
 * @param {string} entry.bestAngle       - AI's chosen angle
 * @param {number} entry.existingCommentCount - How many comments existed before ours
 * @param {string} [entry.authorCountry] - Detected country/region of author
 * @param {string} [entry.postFormat]    - Post format (text, image, video, etc.)
 */
function logCommentPerformance(entry) {
  const data = readData();

  data.comments.push({
    ...entry,
    timestamp: new Date().toISOString(),
    // Future fields for manual tracking or automated scraping:
    authorReplied: null,     // Did the author reply to our comment?
    profileViewSpike: null,  // Did we see a profile view increase?
    connectionReceived: null, // Did the author send us a connection?
  });

  data.stats.totalComments = data.comments.length;

  // Update rolling style/type counts
  if (entry.style) {
    data.stats[`style_${entry.style}`] = (data.stats[`style_${entry.style}`] || 0) + 1;
  }
  if (entry.type) {
    data.stats[`type_${entry.type}`] = (data.stats[`type_${entry.type}`] || 0) + 1;
  }

  writeData(data);
}

// ─────────────────────────────────────────────────────────────────
//  QUERY FUNCTIONS
// ─────────────────────────────────────────────────────────────────

/**
 * Get all tracked performance data.
 */
function getPerformanceData() {
  return readData();
}

/**
 * Aggregate stats by comment style.
 * @returns {Array<{ style: string, count: number, percentage: string }>}
 */
function getStyleStats() {
  const data = readData();
  const counts = {};
  const total = data.comments.length || 1;

  for (const c of data.comments) {
    if (c.style) counts[c.style] = (counts[c.style] || 0) + 1;
  }

  return Object.entries(counts)
    .map(([style, count]) => ({
      style,
      count,
      percentage: ((count / total) * 100).toFixed(1) + '%',
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Aggregate stats by comment type.
 * @returns {Array<{ type: string, count: number, percentage: string }>}
 */
function getTypeStats() {
  const data = readData();
  const counts = {};
  const total = data.comments.length || 1;

  for (const c of data.comments) {
    if (c.type) counts[c.type] = (counts[c.type] || 0) + 1;
  }

  return Object.entries(counts)
    .map(([type, count]) => ({
      type,
      count,
      percentage: ((count / total) * 100).toFixed(1) + '%',
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Aggregate stats by detected author country/region.
 * @returns {Array<{ country: string, count: number }>}
 */
function getCountryStats() {
  const data = readData();
  const counts = {};

  for (const c of data.comments) {
    const country = c.authorCountry || 'unknown';
    counts[country] = (counts[country] || 0) + 1;
  }

  return Object.entries(counts)
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Get the top N best angles used across comments.
 * @param {number} n - How many to return
 * @returns {Array<{ angle: string, count: number }>}
 */
function getBestAngles(n = 10) {
  const data = readData();
  const counts = {};

  for (const c of data.comments) {
    if (c.bestAngle) {
      const key = c.bestAngle.toLowerCase().trim();
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  return Object.entries(counts)
    .map(([angle, count]) => ({ angle, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

/**
 * Get a summary string for logging.
 */
function getSummary() {
  const data = readData();
  const total = data.comments.length;
  if (total === 0) return 'No comments tracked yet.';

  const styles = getStyleStats().slice(0, 3).map(s => `${s.style}:${s.count}`).join(', ');
  const types  = getTypeStats().slice(0, 3).map(t => `${t.type}:${t.count}`).join(', ');

  return `${total} comments tracked | Top styles: ${styles} | Top types: ${types}`;
}

module.exports = {
  logCommentPerformance,
  getPerformanceData,
  getStyleStats,
  getTypeStats,
  getCountryStats,
  getBestAngles,
  getSummary,
};
