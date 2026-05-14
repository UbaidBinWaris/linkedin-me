const { OpenAI } = require('openai');
require('dotenv').config();

let openaiClient = null;

function getOpenAI() {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set in environment variables');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

/**
 * Sends a prompt to OpenAI chat and returns the response.
 * @param {string} prompt - The message to send to ChatGPT.
 * @returns {Promise<string>} The response from ChatGPT.
 */
async function askChatGPT(prompt) {
  const openai = getOpenAI();
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Using gpt-4o-mini as a good default
      messages: [{ role: 'user', content: prompt }],
    });
    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error in askChatGPT:', error);
    throw error;
  }
}

module.exports = { askChatGPT };
