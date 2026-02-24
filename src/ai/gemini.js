'use strict';
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

let genAI = null;
let model = null;

function getModel() {
  if (!model) {
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not set in your .env file!');
    }
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
    model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }
  return model;
}

// ────────────────────────────────────────────────────────────
//  INTEREST SCORING — decides if a post is worth commenting on
// ────────────────────────────────────────────────────────────

/**
 * Asks Gemini to score a post's interest level (0–100) and return
 * a boolean: worth commenting or not.
 *
 * @param {string} postText
 * @param {string} authorName
 * @returns {Promise<{score: number, reason: string, interesting: boolean}>}
 */
async function scorePostInterest(postText, authorName) {
  const m = getModel();

  const scoringPrompt = `You are a professional LinkedIn engagement advisor.

Evaluate this LinkedIn post by ${authorName || 'someone'} and score it from 0 to 100 on how INTERESTING and WORTH COMMENTING it is.

✅ Score HIGH if the post:
- Shares a real insight, opinion, or story from a founder/CEO/senior leader
- Is about entrepreneurship, tech, startup life, product, leadership, AI, or developer experience
- Is thought-provoking, contrarian, or inspiring with actual substance
- Would give a Full Stack Developer something valuable to add
- Has 200+ characters of real original content

❌ Score LOW (under 25) and set interesting: false if the post:
- Is from someone "open to work", "seeking opportunities", "looking for a role", or job hunting
- Appears to be from a student, fresher, recent grad, or entry-level profile
- Is a basic job postting or hiring announcement with no insight
- Is a generic motivational quote with no personal context
- Is pure self-promotion with no reader takeaway
- Is shorter than 100 characters
- Is a reshare of someone else's content with no original commentary added

Post text:
"""
${postText.slice(0, 1000)}
"""

Respond with ONLY valid JSON (no markdown, no explanation):
{"score": <number 0-100>, "reason": "<one sentence>", "interesting": <true or false>}`;


  try {
    const result = await m.generateContent(scoringPrompt);
    const text = result.response.text().trim();
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      score: parsed.score || 0,
      reason: parsed.reason || '',
      interesting: parsed.interesting === true && (parsed.score || 0) >= config.bot.minInterestScore,
    };
  } catch {
    // On parse error, fall back to a basic heuristic
    const score = estimateInterestHeuristic(postText);
    return {
      score,
      reason: 'Scored via heuristic (AI parse failed)',
      interesting: score >= config.bot.minInterestScore,
    };
  }
}

/**
 * Fallback heuristic interest score (0–100) without calling AI.
 * @param {string} text
 * @returns {number}
 */
function estimateInterestHeuristic(text) {
  let score = 0;
  const t = text.toLowerCase();

  // Length bonus
  if (text.length > 300) score += 20;
  if (text.length > 600) score += 10;

  // Topic relevance
  const goodKeywords = [
    'startup', 'founder', 'product', 'engineer', 'developer', 'ai', 'tech', 'code',
    'build', 'launch', 'lesson', 'learned', 'mistake', 'growth', 'scale',
    'team', 'culture', 'leadership', 'cto', 'ceo', 'saas', 'open source',
    'nextjs', 'react', 'node', 'devops', 'hiring', 'failed', 'shipped',
  ];
  for (const kw of goodKeywords) {
    if (t.includes(kw)) score += 6;
  }

  // Bad signals
  if (t.includes('hiring for') && text.length < 200) score -= 30;
  if (t.includes('dm me') && text.length < 150) score -= 20;

  return Math.min(100, Math.max(0, score));
}

// ────────────────────────────────────────────────────────────
//  COMMENT GENERATION — personalized to Ubaid's profile
// ────────────────────────────────────────────────────────────

/**
 * Generates a professional, personalized LinkedIn comment.
 * @param {string} postText
 * @param {string} authorName
 * @returns {Promise<string>}
 */
async function generateComment(postText, authorName) {
  const m = getModel();
  const { name, headline, about } = config.profile;

  const prompt = `You are writing a LinkedIn comment ON BEHALF of ${name}, who is a ${headline}.

About ${name}:
${about}

You are commenting on a post by ${authorName || 'a founder/CEO'}. Your comment should:
- Feel genuinely written by a ${headline.split('|')[0].trim()}
- Reference something SPECIFIC from the post — do NOT write a generic reply
- Add real value: share a related developer/builder experience, a contrasting thought, or a smart follow-up question
- Sound like a real human professional (NOT AI-generated, NOT flattery)
- Be 2–3 short sentences maximum
- NO emojis, NO hashtags, NO "Great post!" type openers
- NOT mention your own name or profile

The post by ${authorName || 'the author'}:
"""
${postText.slice(0, 1500)}
"""

Write ONLY the comment text, nothing else:`;

  const result = await m.generateContent(prompt);
  const text = result.response.text().trim();

  if (!text || text.length < 15) {
    throw new Error('Gemini returned an empty or too-short comment');
  }

  return text;
}

module.exports = { generateComment, scorePostInterest };
