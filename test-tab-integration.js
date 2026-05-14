const { createSession, closeSession } = require('./src/browser/session');
const { generateCommentViaWeb } = require('./src/ai/chatgpt-tab-helper');

async function main() {
  console.log('Starting integration test...');
  
  // 1. Launch browser with LinkedIn session
  console.log('Step 1: Launching browser with LinkedIn session...');
  const { browser, page } = await createSession();
  
  try {
    // 2. Call the web helper
    console.log('\nStep 2: Calling ChatGPT web helper...');
    const samplePost = "AI is changing the world. As a software engineer, I'm excited to see how it improves developer productivity.";
    const sampleStyle = { label: "Draw a Parallel", instruction: "Compare tech to something relatable." };
    
    const result = await generateCommentViaWeb(browser, samplePost, "John Doe", sampleStyle);
    
    console.log('\n======================================');
    console.log('Result from ChatGPT Web:');
    console.log('======================================');
    console.log('Comment:', result.comment);
    console.log('Angle:', result.bestAngle);
    console.log('Score:', result.interestScore);
    console.log('======================================\n');
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.log('If you saw a login screen or Cloudflare check, ensure you ran node open-bot-profile.js first to log in.');
  } finally {
    console.log('Step 3: Closing session...');
    await closeSession(browser);
    console.log('Done.');
  }
}

main();
