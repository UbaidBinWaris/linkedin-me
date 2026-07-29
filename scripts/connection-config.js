'use strict';
/**
 * connection-config.js — Configuration for the LinkedIn Connection Bot
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  Edit THIS FILE to control every aspect of the connection bot.  ║
 * ║  No need to touch connection-bot.js or any src/ files.          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

require('dotenv').config();

const connectionConfig = {

  // ── Search / Targeting ──────────────────────────────────────────────
  //
  // Paste a LinkedIn People Search URL here.
  // ➜ Best practice: apply geoUrn + network filters on LinkedIn first, THEN copy URL.
  //
  // Common geoUrn codes (add &geoUrn=["<id>"] to your URL):
  //   USA         → 103644278
  //   UK          → 101165590
  //   UAE/Dubai   → 104305776
  //   Australia   → 101452733
  //   Canada      → 101174742
  //   Saudi Arabia→ 105047199
  //   Qatar       → 104172105
  //
  // Example — US only, 2nd+3rd degree:
  //   https://www.linkedin.com/search/results/people/?network=%5B%22S%22%2C%22O%22%5D&geoUrn=%5B%22103644278%22%5D&origin=FACETED_SEARCH
  //
  // Override with env var: CONNECTION_SEARCH_URL
  searchUrl: process.env.CONNECTION_SEARCH_URL ||
    'https://www.linkedin.com/search/results/people/?network=%5B%22S%22%2C%22O%22%5D&geoUrn=%5B%22103644278%22%5D&origin=FACETED_SEARCH',

  // Maximum connection requests to send in one run (safety cap).
  // LinkedIn's unofficial soft-limit is ~20-25/day. Stay well under it.
  // Override with env var: CONNECTION_MAX_PER_RUN
  maxConnectionsPerRun: parseInt(process.env.CONNECTION_MAX_PER_RUN || '15', 10),

  // Hard daily safety cap — bot will stop even mid-run if this is reached.
  // Override with env var: CONNECTION_DAILY_LIMIT
  dailyLimit: parseInt(process.env.CONNECTION_DAILY_LIMIT || '20', 10),

  // How many search result pages to paginate through when collecting candidates.
  maxSearchPages: parseInt(process.env.CONNECTION_MAX_SEARCH_PAGES || '5', 10),

  // ── Include Filters — TARGET decision-makers & buyers ───────────────
  //
  // A profile's headline must contain at least ONE of these keywords
  // (case-insensitive) to be considered for connecting.
  // Set to [] (empty array) to target everyone (not recommended).
  //
  // ⚠ Focus on BUYERS, not peers. Developers & engineers rarely hire you.
  targetRoles: [
    'founder',
    'co-founder',
    'cofounder',
    'ceo',
    'chief executive',
    'cto',
    'chief technology officer',
    'coo',
    'owner',
    'entrepreneur',
    'startup founder',
    'saas founder',
    'product manager',
    'product lead',
    'head of engineering',
    'head of product',
    'head of technology',
    'director of engineering',
    'director of product',
    'vp engineering',
    'vp of engineering',
    'vice president engineering',
    'vp product',
    'tech lead',
    'engineering manager',
    'investor',
    'angel investor',
    'venture',
    'managing director',
    'general partner',
    'principal',
  ],

  // ── Target Countries (hard code-level filter on location field) ──────
  //
  // If a candidate's scrapped location doesn't match any of these terms,
  // they are skipped regardless of the search URL filter.
  // This is a SECOND safety net in case LinkedIn leaks other countries.
  //
  // Set to [] to skip the country filter (rely on searchUrl alone).
  targetCountries: [
    // United States — country + major metros
    'united states', 'usa',
    'new york', 'los angeles', 'san francisco', 'bay area', 'chicago',
    'seattle', 'boston', 'austin', 'denver', 'dallas', 'houston',
    'miami', 'atlanta', 'washington', 'phoenix', 'portland',
    'san jose', 'san diego', 'detroit', 'philadelphia', 'minneapolis',
    'metropolitan area', 'metro area',        // catches "New York City Metropolitan Area"
    'greater new york', 'greater chicago', 'greater boston',
    'greater los angeles', 'greater seattle', 'greater san francisco',
    'greater washington', 'greater miami', 'greater dallas',
    // United Kingdom
    'united kingdom', 'england', 'london', 'manchester', 'birmingham',
    'leeds', 'glasgow', 'edinburgh', 'liverpool', 'bristol', 'sheffield',
    'greater london',
    // UAE
    'dubai', 'uae', 'united arab emirates', 'abu dhabi', 'sharjah',
    // Australia
    'australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide',
    // Canada
    'canada', 'toronto', 'vancouver', 'calgary', 'montreal', 'ottawa',
    // Middle East
    'saudi', 'riyadh', 'jeddah', 'saudi arabia',
    'qatar', 'doha',
    'israel', 'tel aviv',
    // Europe
    'netherlands', 'amsterdam', 'rotterdam',
    'germany', 'berlin', 'munich', 'hamburg', 'frankfurt',
    'sweden', 'stockholm',
    'denmark', 'copenhagen',
    'ireland', 'dublin',
    // Asia-Pacific
    'singapore',
    'india', 'mumbai', 'bangalore', 'delhi', 'hyderabad', 'pune',
    'new zealand', 'auckland',
    // Africa
    'south africa', 'johannesburg', 'cape town',
  ],

  // ── Exclude Filters (who to SKIP) ──────────────────────────────────

  skipStudents:  true,   // skip student / intern headlines
  skipOpenToWork: true,  // skip OTW profiles
  skipRecruiters: true,  // skip recruiters / HR / talent acquisition
  skip1stDegree:  true,  // skip already-connected profiles

  // Any additional words in the headline that trigger a skip.
  customSkipWords: [
    'sales', 'account executive', 'account manager', 'seo',
    'social media', 'digital marketing', 'content creator',
    'real estate', 'insurance', 'loan', 'mortgage',
    'accountant', 'accounting', 'auditor', 'bookkeeper',
    'professor', 'lecturer', 'teacher', 'tutor',
    'developer', 'engineer', 'programmer', 'software',   // ← skip pure devs
  ],

  // ── Internal signal arrays (used by the filter logic) ───────────────

  _studentSignals: [
    'student', 'undergraduate', 'undergrad', 'bsc student', 'btech student',
    'cs student', 'computer science student', 'engineering student',
    'intern', 'internship', 'fresher', 'fresh graduate', 'recent graduate',
    'new graduate', 'entry level', 'entry-level',
    'aspiring developer', 'aspiring engineer', 'bootcamp',
    'self-taught', 'learning to code', 'learning programming',
  ],

  _otwSignals: [
    'open to work', 'open to opportunities', '#opentowork', 'open for work',
    '#openforwork', 'actively seeking', 'actively looking', 'available for hire',
    'seeking a role', 'looking for a job', 'looking for work',
    '#jobseeker', '#hireme', '#lookingforjob',
  ],

  _recruiterSignals: [
    'recruiter', 'recruiting', 'talent acquisition', 'talent partner',
    'hr ', 'human resources', 'people operations', 'hiring manager',
    'headhunter', 'staffing', 'executive search', 'sourcer', 'sourcing',
  ],

  // ── AI Note Generation ──────────────────────────────────────────────
  //
  // The bot uses OpenAI (gpt-4o-mini) to write a unique, personalised note
  // for each connection request. Falls back to Gemini, then to the static
  // templates below if no AI key is available.
  //
  // sendNote: true  → always include a note (strongly recommended — 3-5× acceptance rate)
  // sendNote: false → send blank connection (lower acceptance, but faster)
  sendNote: true,

  // Static fallback templates used when AI is unavailable.
  // Use {firstName} and {role} as placeholders.
  // LinkedIn hard cap: 300 chars. Keep each under 280 to be safe.
  noteTemplates: [
    "Hi {firstName}, I'm Ubaid — a Full-Stack developer building SaaS platforms and AI automation tools. Your work in {role} looks interesting. Would love to connect with the people shaping this space!",

    "Hi {firstName}, I build web applications and AI workflows for founders and product teams. Your background in {role} caught my eye — would love to connect and stay in each other's feeds.",

    "Hi {firstName}, I'm a Full-Stack dev specialising in Next.js, Node.js, and AI tooling. I try to connect with founders and product leaders building interesting things. Hope it's okay to reach out!",

    "Hi {firstName}, came across your profile and appreciated your focus on {role}. I build scalable SaaS and automation tools — always great to connect with decision-makers in tech. Would love to add you!",
  ],

  // ── Human-like Pacing ───────────────────────────────────────────────

  minDelayMs: parseInt(process.env.MIN_DELAY_MS || '2000', 10),
  maxDelayMs: parseInt(process.env.MAX_DELAY_MS || '6000', 10),

  // Wait between each connection request (milliseconds).
  // 25–60 seconds is safe and human-looking. Do NOT go below 15s.
  betweenRequestMinMs: parseInt(process.env.CONNECTION_BREAK_MIN_MS || '25000', 10),
  betweenRequestMaxMs: parseInt(process.env.CONNECTION_BREAK_MAX_MS || '60000', 10),

  // 0.0–1.0 random skip chance per valid candidate (adds natural variance).
  skipChance: parseFloat(process.env.CONNECTION_SKIP_CHANCE || '0.10'),

  // ── Data / Logging ──────────────────────────────────────────────────

  sentConnectionsPath: process.env.CONNECTION_CSV_PATH || './data/sent_connections.csv',

  // ── Dry Run ─────────────────────────────────────────────────────────
  // DRY_RUN=true → logs everything but does NOT click anything.
  dryRun: process.env.DRY_RUN === 'true',
};

module.exports = connectionConfig;
