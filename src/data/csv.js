'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const config = require('../config');

/**
 * Ensures the data directory and CSV files exist with proper headers.
 */
function ensureDataFiles() {
  const dataDir = path.dirname(config.data.commentedPostsPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Create commented_posts.csv with header if missing
  if (!fs.existsSync(config.data.commentedPostsPath)) {
    fs.writeFileSync(
      config.data.commentedPostsPath,
      'post_url,author_name,comment_text,commented_at\n',
      'utf-8'
    );
  }

  // Create target_profiles.csv with header if missing
  if (!fs.existsSync(config.data.targetProfilesPath)) {
    fs.writeFileSync(
      config.data.targetProfilesPath,
      'profile_url,name,category\n',
      'utf-8'
    );
  }
}

/**
 * Reads the commented_posts.csv and returns a Set of post URLs already commented on.
 * @returns {Promise<Set<string>>}
 */
async function readCommentedPosts() {
  ensureDataFiles();
  const commentedUrls = new Set();

  const fileContent = fs.readFileSync(config.data.commentedPostsPath, 'utf-8');
  const lines = fileContent.trim().split('\n');

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // post_url is the first column — handle quoted CSV values
    const firstComma = line.indexOf(',');
    if (firstComma === -1) continue;
    let url = line.substring(0, firstComma).trim();
    // Remove surrounding quotes if present
    if (url.startsWith('"') && url.endsWith('"')) {
      url = url.slice(1, -1);
    }
    if (url) commentedUrls.add(url);
  }

  return commentedUrls;
}

/**
 * Counts how many posts have been commented on TODAY (since midnight local time).
 * @returns {Promise<{count: number, todayUrls: Set<string>}>}
 */
async function readTodayCommentedCount() {
  ensureDataFiles();
  const todayUrls = new Set();

  const fileContent = fs.readFileSync(config.data.commentedPostsPath, 'utf-8');
  const lines = fileContent.trim().split('\n');

  // Today's date as YYYY-MM-DD in local time
  const today = new Date().toISOString().slice(0, 10);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    // cols: [post_url, author_name, comment_text, commented_at]
    const url = cols[0] ? cols[0].replace(/^"|"$/g, '').trim() : '';
    const timestamp = cols[3] ? cols[3].replace(/^"|"$/g, '').trim() : '';
    if (url && timestamp && timestamp.startsWith(today)) {
      todayUrls.add(url);
    }
  }

  return { count: todayUrls.size, todayUrls };
}

/**
 * Appends a new commented post record to the CSV.
 * @param {string} postUrl
 * @param {string} authorName
 * @param {string} commentText
 */
async function writeCommentedPost(postUrl, authorName, commentText) {
  ensureDataFiles();
  const timestamp = new Date().toISOString();

  const csvWriter = createCsvWriter({
    path: config.data.commentedPostsPath,
    header: [
      { id: 'post_url', title: 'post_url' },
      { id: 'author_name', title: 'author_name' },
      { id: 'comment_text', title: 'comment_text' },
      { id: 'commented_at', title: 'commented_at' },
    ],
    append: true,
  });

  await csvWriter.writeRecords([
    {
      post_url: postUrl,
      author_name: authorName,
      comment_text: commentText,
      commented_at: timestamp,
    },
  ]);
}

/**
 * Reads target_profiles.csv and returns an array of { profileUrl, name, category }.
 * @returns {Promise<Array<{profileUrl: string, name: string, category: string}>>}
 */
async function readTargetProfiles() {
  ensureDataFiles();
  const profiles = [];

  const fileContent = fs.readFileSync(config.data.targetProfilesPath, 'utf-8');
  const lines = fileContent.trim().split('\n');

  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV manually to handle commas in quoted fields
    const cols = parseCSVLine(line);
    if (cols.length >= 1 && cols[0]) {
      profiles.push({
        profileUrl: cols[0].trim(),
        name: (cols[1] || '').trim(),
        category: (cols[2] || '').trim(),
      });
    }
  }

  return profiles;
}

/**
 * Simple CSV line parser that handles quoted fields.
 * @param {string} line
 * @returns {string[]}
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

module.exports = {
  ensureDataFiles,
  readCommentedPosts,
  readTodayCommentedCount,
  writeCommentedPost,
  readTargetProfiles,
};
