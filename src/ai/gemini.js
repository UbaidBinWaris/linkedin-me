'use strict';
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

let genAI = null;
let model = null;

/**
 * Initialize the Gemini client (lazy singleton).
 */
function getModel() {
  if (!model) {
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not set in your .env file!');
    }
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
    model = genAI.getGenerativeModel({ model: 'gemini-pro' });
  }
  return model;
}

/**
 * Generates a thoughtful, professional LinkedIn comment for a given post.
 * @param {string} postText - The text content of the LinkedIn post
 * @param {string} authorName - The name of the post author
 * @returns {Promise<string>} - The generated comment
 */
async function generateComment(postText, authorName) {
  const m = getModel();

  const prompt = `You are a genuine LinkedIn professional who engages thoughtfully with great content.

Read the following LinkedIn post by ${authorName || 'a founder/CEO'} and write a professional, insightful comment.

Guidelines for the comment:
- Be genuine, warm, and professional (NOT generic or sycophantic)
- Add real value: share a related insight, ask a meaningful question, or build on their idea
- Length: 2-3 short sentences maximum
- NO emojis, NO hashtags, NO "Great post!" or generic openers
- Sound like a real human, not an AI
- Directly reference something specific from the post content

Post content:
"""
${postText.slice(0, 1500)}
"""

Write ONLY the comment text, nothing else:`;

  const result = await m.generateContent(prompt);
  const response = await result.response;
  const text = response.text().trim();

  // Safety check - ensure we got a valid response
  if (!text || text.length < 10) {
    throw new Error('Gemini returned an empty or too-short comment');
  }

  return text;
}

module.exports = { generateComment };
