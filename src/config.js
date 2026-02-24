'use strict';
require('dotenv').config();

const config = {
  geminiApiKey:  process.env.GEMINI_API_KEY  || '',
  openaiApiKey:  process.env.OPENAI_API_KEY  || '',
  linkedin: {
    email: process.env.LINKEDIN_EMAIL || '',
    password: process.env.LINKEDIN_PASSWORD || '',
  },
  bot: {
    maxCommentsPerRun: parseInt(process.env.MAX_COMMENTS_PER_RUN || '10', 10),
    minDelayMs: parseInt(process.env.MIN_DELAY_MS || '3000', 10),
    maxDelayMs: parseInt(process.env.MAX_DELAY_MS || '8000', 10),
    // Minimum engagement score for a post to be considered "interesting"
    // Scale: 0-100. Posts below this are skipped.
    minInterestScore: parseInt(process.env.MIN_INTEREST_SCORE || '40', 10),
  },
  browser: {
    headless: process.env.HEADLESS === 'true',
    sessionDir: process.env.SESSION_DIR || './session',
  },
  data: {
    commentedPostsPath: './data/commented_posts.csv',
    targetProfilesPath: './data/target_profiles.csv',
  },
  // ── Scheduling ──
  // The bot will refuse to run outside of this time window.
  schedule: {
    // Timezone used for scheduling checks. See: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
    timezone: process.env.SCHEDULE_TIMEZONE || 'Asia/Karachi',   // UTC+5 Pakistan Standard Time
    // Allowed hours (24h format, inclusive). Bot runs between startHour and endHour.
    startHour: parseInt(process.env.SCHEDULE_START_HOUR || '9', 10),   // 9:00 AM
    endHour: parseInt(process.env.SCHEDULE_END_HOUR || '22', 10),      // 10:00 PM
    // Days of the week to run (0=Sunday, 1=Monday … 6=Saturday).
    // Default: Monday–Friday + Saturday (skip Sunday for natural feel)
    activeDays: (process.env.SCHEDULE_ACTIVE_DAYS || '1,2,3,4,5,6')
      .split(',')
      .map((d) => parseInt(d.trim(), 10)),
  },
  // ── Your LinkedIn profile (used in Gemini prompt) ──
  profile: {
    name: process.env.MY_NAME || 'Ubaid Waris',
    headline: process.env.MY_HEADLINE || 'Full Stack Developer | Next.js | Node.js | React | DevOps',
    about: process.env.MY_ABOUT ||
      'I build scalable web applications and automation tools. ' +
      'Passionate about clean code, developer productivity, and emerging technologies.',
  },
};

module.exports = config;
