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
async function generateText(systemPrompt, userPrompt, forceJson = false) {
  // Try OpenAI first
  if (hasOpenAI()) {
    try {
      const ai = getOpenAI();
      const params = {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        max_tokens: 400,
        temperature: 0.75, // Lowered for more realism
      };
      
      if (forceJson) {
        params.response_format = { type: 'json_object' };
      }

      const res = await ai.chat.completions.create(params);
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
- Post length is between 300 and 1200 characters
- Contains numbers, data, or metrics
- Contains story-arc words like "started", "learned", "realized", "failed"

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
    const raw = await generateText(systemPrompt, userPrompt, true);
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
 *
/**
 * Generates a personalized professional LinkedIn comment WITH AI reasoning.
 *
 * Returns: { comment, interestScore, whyInteresting, bestAngle }
 *
 * @param {string} postText    - The post content
 * @param {string} authorName  - Author's name
 * @param {object} [commentStyle] - Style from commentStyles.js
 */
async function generateComment(postText, authorName, commentStyle = null) {
  const { name, headline, about } = config.profile;

  // Emotional tone detection
  const textLower = postText.toLowerCase();
  let toneInstruction = '';
  if (/excited|grateful|milestone|proud|thrilled|win/.test(textLower)) {
    toneInstruction = 'Tone of post appears to be celebratory. Match that tone subtly.';
  } else if (/burnout|struggle|failure|hard|tough|layoff|fired/.test(textLower)) {
    toneInstruction = 'Tone of post appears to be empathetic. Match that tone subtly.';
  }

  // 15% chance to output a single 1-liner reaction instead of a deep thought
  const overrideShort = (Math.random() < 0.15)
    ? '\nCRITICAL RULE FOR THIS COMMENT: Return 1 short line. No deep insight. Just a simple, casual micro-reaction.'
    : '';

  // Integrate comment type
  const commentTypeObj = require('./commentStyles').pickRandomType();
  const typeInstruction = commentTypeObj ? `\nComment Type to aim for: ${commentTypeObj.label}` : '';

  const styleInstruction = commentStyle
    ? `\nYour writing approach for this comment — "${commentStyle.label}":\n${commentStyle.instruction}\n`
    : '';

  const systemPrompt = `You are writing a LinkedIn comment on behalf of ${name}, a ${headline.split('|')[0].trim()}. Respond ONLY with valid JSON — no markdown, no explanation outside the JSON.
Write like an active LinkedIn user in tech. Vary tone naturally. Do not sound like an AI assistant. Avoid structured corporate language.`;

  const userPrompt = `Analyze this LinkedIn post and write a comment as ${name}.

About ${name}:
${about}
${styleInstruction}${typeInstruction}
${toneInstruction}${overrideShort}

Post by ${authorName || 'the author'}:
"""
${postText.slice(0, 1500)}
"""

Comment rules:
- Keep it concise. Usually under 150 characters unless depth is needed.
- If you assess interest_score between 40 and 65, generate a short lightweight comment.
- If between 65 and 85, generate a medium thoughtful comment.
- If above 85, generate a deeper comment.
- Vary structure. Some comments can be one sentence. Some two.
- ONLY ask a question at the end IF the post contains incomplete/mismatched info, or introduces new tech needing explanation. Otherwise, do NOT include a question.
- Sound like a real human professional. Sometimes start with "So true." or "Love this."
- Reference ONE specific concept from the post — not a generic reflection.
- Avoid generic praise unless combined with a specific reference to the post.
- Avoid academic phrasing and buzzwords like leverage, optimize, paradigm. Avoid list-like structure.
- NO emojis, NO hashtags.
- Do NOT mention ${name}'s own name.
- Do NOT be sycophantic or flattering. You are peers.
- NEVER use the "—" (em-dash) or "-" (hyphen) character to separate thoughts. Just use normal periods.

Respond with ONLY this JSON:
{
  "interest_score": <0-100, how worth commenting this post is>,
  "why_interesting": "<one concise sentence explaining what makes this post valuable>",
  "best_angle": "<one sentence on the most effective angle for a comment>",
  "comment": "<the actual comment text>"
}`;

  try {
    const raw = await generateText(systemPrompt, userPrompt, true);
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.comment || parsed.comment.length < 10) {
      throw new Error('AI returned empty comment in JSON');
    }

    return {
      comment:        parsed.comment.trim(),
      interestScore:  typeof parsed.interest_score === 'number' ? parsed.interest_score : 50,
      whyInteresting: parsed.why_interesting || '',
      bestAngle:      parsed.best_angle || '',
    };
  } catch (e) {
    // Fallback: try raw text generation without JSON structure
    console.log('    ⚠️  JSON comment generation failed, falling back to raw text...');
    const fallbackPrompt = `Write a 1-2 sentence LinkedIn comment as ${name} on this post by ${authorName}.
${styleInstruction}
Post: "${postText.slice(0, 800)}"

Rules: No emojis, no "Great post!", reference something specific, be concise (under 180 chars).
Write ONLY the comment text:`;

    try {
      const raw = await generateText(systemPrompt, fallbackPrompt);
      return {
        comment:        raw.trim(),
        interestScore:  50,
        whyInteresting: 'Fallback mode',
        bestAngle:      '',
      };
    } catch (fallbackError) {
      throw new Error(`AI generation completely failed (Network or API issue). Last error: ${fallbackError.message}`);
    }
  }
}

// ── Heuristic fallback ───────────────────────────────────────────
function estimateHeuristic(text) {
  let score = 0;
  const t = text.toLowerCase();
  if (text.length >= 300 && text.length <= 1200) score += 20;
  else if (text.length > 1200) score += 10;
  else if (text.length > 300) score += 10; // Fallback
  
  if (/\d/.test(t)) score += 10; // Contains numbers
  
  const good = ['startup','founder','product','engineer','developer','ai','tech','code','build','launch','lesson','learned','mistake','growth','scale','team','leadership','cto','ceo','saas','nextjs','react','node','devops','shipped','started','realized','failed'];
  for (const kw of good) if (t.includes(kw)) score += 5;
  if (t.includes('hiring for') && text.length < 200) score -= 30;
  if (t.includes('open to work')) score -= 40;
  return Math.min(100, Math.max(0, score));
}

module.exports = { generateComment, scorePostInterest };

