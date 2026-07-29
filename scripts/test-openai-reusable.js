const { askChatGPT } = require('./src/ai/openai-helper');

async function main() {
  try {
    console.log('--- Test 1: Sending first message ---');
    console.log('Prompt: Say "Hello from the first call!"');
    const res1 = await askChatGPT('Say "Hello from the first call!"');
    console.log('Response 1:', res1.trim());

    console.log('\n--- Test 2: Sending second message ---');
    console.log('Prompt: Say "Hello from the second call!"');
    const res2 = await askChatGPT('Say "Hello from the second call!"');
    console.log('Response 2:', res2.trim());

    console.log('\n--- Test 3: Asking a question ---');
    console.log('Prompt: What is 2 + 2?');
    const res3 = await askChatGPT('What is 2 + 2?');
    console.log('Response 3:', res3.trim());

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.log('Please ensure OPENAI_API_KEY is set correctly in your .env file.');
  }
}

main();
