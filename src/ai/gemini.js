'use strict';
/**
 * AI module — supports both OpenAI and Google Gemini.
 * Priority: OpenAI (if OPENAI_API_KEY is set) → Gemini (if GEMINI_API_KEY is set)
 * Falls back to heuristic scoring if both fail.
 */

const config = require('../config');

// ── Lazy-loaded clients ──────────────────────────────────────────
let openaiClient = null;
let geminiModel  = null;

function getOpenAI() {
  if (!openaiClient) {
    const { OpenAI } = require('openai');
    openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return openaiClient;
}

function getGemini() {
  if (!geminiModel) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }
  return geminiModel;
}

// ── Detect which provider to use ────────────────────────────────
function hasOpenAI() {
  return !!(config.openaiApiKey && config.openaiApiKey.startsWith('sk-') && config.openaiApiKey.length > 20);
}
function hasGemini() {
  return !!(config.geminiApiKey && config.geminiApiKey.length > 20);
}

// ── Raw text generation (provider-agnostic) ──────────────────────
async function generateText(systemPrompt, userPrompt) {
  // Try OpenAI first
  if (hasOpenAI()) {
    try {
      const ai = getOpenAI();
      const res = await ai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        max_tokens: 400,
        temperature: 0.85,
      });
      return res.choices[0].message.content.trim();
    } catch (e) {
      if (hasGemini()) {
        console.log('  OpenAI failed, trying Gemini:', e.message.slice(0, 60));
      } else {
        throw e;
      }
    }
  }

  // Try Gemini as fallback
  if (hasGemini()) {
    const m = getGemini();
    const result = await m.generateContent(systemPrompt + '\n\n' + userPrompt);
    return result.response.text().trim();
  }

  throw new Error('No working AI provider. Set OPENAI_API_KEY or GEMINI_API_KEY in .env');
}

// ── Interest scoring ─────────────────────────────────────────────
/**
 * Scores a post 0-100 and decides if it's worth commenting on.
 */
async function scorePostInterest(postText, authorName) {
  const systemPrompt = `You are a professional LinkedIn engagement advisor. Respond ONLY with valid JSON — no markdown, no explanation.`;

  const userPrompt = `Score this LinkedIn post from 0 to 100 on how INTERESTING and WORTH COMMENTING it is.

✅ Score HIGH (60-100) if:
- Written by a founder, CEO, senior engineer, or leader
- About entrepreneurship, tech, AI, startup life, product, leadership, or developer experience
- Has a real opinion, insight, story, or lesson (not just facts)
- Would give a Full Stack Developer something valuable to add
- Has at least 200 characters of original content

❌ Score LOW (0-30) and set interesting:false if:
- Author is "open to work", job hunting, student, fresher, or entry-level
- It's a hiring announcement or job post
- It's a generic motivational quote with no personal context
- Pure self-promotion / brand content with no reader takeaway
- Less than 100 characters
- A reshare with no commentary

Post by: ${authorName || 'Unknown'}
Post text:
"""
${postText.slice(0, 1200)}
"""

Respond with ONLY this JSON:
{"score": <0-100>, "reason": "<one short sentence>", "interesting": <true|false>}`;

  try {
    const raw = await generateText(systemPrompt, userPrompt);
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      score:       typeof parsed.score === 'number' ? parsed.score : 0,
      reason:      parsed.reason || '',
      interesting: parsed.interesting === true && (parsed.score || 0) >= config.bot.minInterestScore,
    };
  } catch {
    const score = estimateHeuristic(postText);
    return {
      score,
      reason: 'Heuristic (AI unavailable)',
      interesting: score >= config.bot.minInterestScore,
    };
  }
}

// ── Comment generation ───────────────────────────────────────────
/**
 * Generates a personalized professional LinkedIn comment.
 */
async function generateComment(postText, authorName) {
  const { name, headline, about } = config.profile;

  const systemPrompt = `You are writing a LinkedIn comment on behalf of ${name}, a ${headline.split('|')[0].trim()}.`;

  const userPrompt = `Write a short LinkedIn comment (1-2 sentences, max 150 characters) as ${name}.

About ${name}:
${about}

Rules:
- Sound like a real human professional, NOT AI-generated
- Reference something SPECIFIC from the post — not a generic reply
- Add value: share a developer experience or contrarian thought
- NO emojis, NO hashtags, NO "Great post!" openers
- Do NOT mention your own name
- Do NOT be flattering or sycophantic 
- Alaways write in in non-formal way

Post by ${authorName || 'the author'}:
"""
${postText.slice(0, 1500)}
"""

Write ONLY the comment text, nothing else:`;

  const text = await generateText(systemPrompt, userPrompt);
  if (!text || text.length < 15) throw new Error('AI returned empty comment');
  return text;
}

// ── Heuristic fallback ───────────────────────────────────────────
function estimateHeuristic(text) {
  let score = 0;
  const t = text.toLowerCase();
  if (text.length > 300) score += 20;
  if (text.length > 600) score += 10;
  const good = ['startup','founder','product','engineer','developer','ai','tech','code','build','launch','lesson','learned','mistake','growth','scale','team','leadership','cto','ceo','saas','nextjs','react','node','devops','shipped'];
  for (const kw of good) if (t.includes(kw)) score += 5;
  if (t.includes('hiring for') && text.length < 200) score -= 30;
  if (t.includes('open to work')) score -= 40;
  return Math.min(100, Math.max(0, score));
}

module.exports = { generateComment, scorePostInterest };
