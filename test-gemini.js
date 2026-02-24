require('dotenv').config();

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

console.log('OpenAI key starts with:', OPENAI_KEY.slice(0, 8) || '(not set)');
console.log('Gemini key starts with:', GEMINI_KEY.slice(0, 8) || '(not set)');

(async () => {
  // Test OpenAI
  if (OPENAI_KEY && OPENAI_KEY.startsWith('sk-') && OPENAI_KEY.length > 20) {
    try {
      const { OpenAI } = require('openai');
      const ai = new OpenAI({ apiKey: OPENAI_KEY });
      const res = await ai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Reply with just the word: WORKING' }],
        max_tokens: 10,
      });
      console.log('\n✅ OpenAI WORKS! Response:', res.choices[0].message.content.trim());
      console.log('   Model: gpt-4o-mini');
    } catch (e) {
      console.log('\n❌ OpenAI failed:', e.message.slice(0, 120));
    }
  } else {
    console.log('\n⚠️  OpenAI key looks like a placeholder — update OPENAI_API_KEY in .env');
  }

  // Test Gemini
  if (GEMINI_KEY && GEMINI_KEY.length > 20) {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(GEMINI_KEY);
      const m = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const r = await m.generateContent('Reply with just the word: WORKING');
      console.log('\n✅ Gemini WORKS! Response:', r.response.text().trim().slice(0, 30));
    } catch (e) {
      console.log('\n❌ Gemini failed:', e.message.slice(0, 100));
    }
  }
})();
