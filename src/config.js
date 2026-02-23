'use strict';
require('dotenv').config();

const config = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  linkedin: {
    email: process.env.LINKEDIN_EMAIL || '',
    password: process.env.LINKEDIN_PASSWORD || '',
  },
  bot: {
    maxCommentsPerRun: parseInt(process.env.MAX_COMMENTS_PER_RUN || '10', 10),
    minDelayMs: parseInt(process.env.MIN_DELAY_MS || '3000', 10),
    maxDelayMs: parseInt(process.env.MAX_DELAY_MS || '8000', 10),
  },
  browser: {
    headless: process.env.HEADLESS === 'true',
    sessionDir: process.env.SESSION_DIR || './session',
  },
  data: {
    commentedPostsPath: './data/commented_posts.csv',
    targetProfilesPath: './data/target_profiles.csv',
  },
};

module.exports = config;
