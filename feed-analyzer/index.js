'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { createSession } = require('../src/browser/session');
const config = require('../src/config');
const { createObjectCsvWriter } = require('csv-writer');

const CSV_PATH = path.join(__dirname, 'feed_analysis.csv');

// Initialize CSV Writer
const csvWriter = createObjectCsvWriter({
  path: CSV_PATH,
  header: [
    { id: 'authorName', title: 'Author Name' },
    { id: 'authorHeadline', title: 'Author Headline' },
    { id: 'postText', title: 'Post Text' },
    { id: 'imageUrl', title: 'Image URL' },
    { id: 'postLink', title: 'Post Link' },
    { id: 'profileLink', title: 'Profile Link' },
    { id: 'likes', title: 'Likes' },
    { id: 'comments', title: 'Comments' },
    { id: 'reposts', title: 'Reposts' },
    { id: 'isPromoted', title: 'Is Promoted' },
    { id: 'aiAnalysis', title: 'AI Analysis' }
  ]
});

// Helper for human-like pauses
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

/**
 * Call local Ollama Llama 3.1 to analyze the post
 */
async function analyzePostWithOllama(postData) {
  try {
    const prompt = `You are an expert social media analyst. Your task is to deeply analyze the following LinkedIn post and predict its impact. 
    
Author: ${postData.authorName}
Headline: ${postData.authorHeadline}
Post Text: ${postData.postText}
Metrics: ${postData.likes} likes, ${postData.comments} comments, ${postData.reposts} reposts.

Please provide a concise analysis structured exactly as follows:
1. Core Topic & Sentiment: [What is the post about? What is the feeling/tone?]
2. Target Audience: [Who is this post trying to reach?]
3. Virality Prediction: [Why is it performing this way, or will it perform well? What makes it engaging or boring?]
4. Key Takeaways: [One or two bullet points]`;

    const response = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.1:latest',
        prompt: prompt,
        stream: false
      })
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error(`Ollama HTTP Error [${response.status}]: ${errText}`);
        return 'AI Analysis Failed';
    }

    const data = await response.json();
    return data.response ? data.response.trim() : 'AI Analysis Failed (No Response Field)';
  } catch (err) {
    console.error(`Error calling Ollama (Network/Fetch): ${err.message}`);
    return 'AI Analysis Failed';
  }
}

/**
 * Scrolls the feed to load posts
 */
async function scrollFeed(page, passes = 5) {
  console.log(`Scrolling feed (${passes} passes)...`);
  try { await page.click('body', { force: true }); } catch (_) {}
  for (let i = 0; i < passes; i++) {
    const amount = 400 + Math.floor(Math.random() * 400);
    try {
      await page.mouse.wheel(0, amount);
      if (i % 2 === 0) {
        try { await page.keyboard.press('PageDown'); } catch (_) {}
      }
      await sleep(800 + Math.floor(Math.random() * 500));
    } catch (_) {}
  }
}

/**
 * Clicks all "…see more" buttons to expand post text
 */
async function clickSeeMore(page) {
  console.log('Clicking "…see more" buttons...');
  const buttons = await page.$$('button.see-more'); // Playwright selector
  for (const btn of buttons) {
    try {
      await btn.click();
      await sleep(300);
    } catch (_) {}
  }
  
  // Try alternative selector for see more
  const textBtns = await page.$$('text="…see more"');
  for (const btn of textBtns) {
     try {
         await btn.click();
         await sleep(300);
     } catch (_) {}
  }
}

/**
 * Parses metrics strings like "1,234 Likes" into numbers
 */
function parseCount(str = '') {
  if (!str) return 0;
  // Handle empty or irrelevant text that got scraped into the metric
  const s = str.toString().replace(/,|likes?|comments?|reposts?|reactions?/gi, '').trim().toUpperCase();
  if (s.includes('M')) return Math.round(parseFloat(s) * 1000000);
  if (s.includes('K')) return Math.round(parseFloat(s) * 1000);
  const parsed = parseInt(s);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Main Extraction Logic
 */
async function extractPosts(page, maxPosts = 5) {
  console.log(`Extracting top ${maxPosts} posts...`);

  // Wait for the feed to load
  await page.waitForSelector('[data-urn*="activity"], [data-id*="activity"], [role="listitem"]', { timeout: 15000 });
  
  // Extract data in browser context
  const extracted = await page.evaluate((max) => {
    const elems = Array.from(document.querySelectorAll(
      '[data-urn*="activity"],[data-id*="activity"],[data-entity-urn],' +
      '[data-view-name="feed-full-update"],' +
      '[role="listitem"][componentkey*="FeedType_"]'
    ));

    const results = [];
    const seenUrns = new Set();

    for (const el of elems) {
      if (results.length >= max) break;

      const urn = el.getAttribute('data-urn') || el.getAttribute('data-id') || el.getAttribute('data-entity-urn') || el.getAttribute('componentkey') || '';
      if (!urn || seenUrns.has(urn)) continue;
      seenUrns.add(urn);

      // Check for promoted
      const textContent = el.innerText || '';
      if (textContent.length < 50) continue; // Skip small invalid cards
      
      const isPromoted = /Promoted|Sponsored/i.test(textContent);

      // Extract text content carefully
      let postText = '';
      const textNode = el.querySelector('.update-components-text, .feed-shared-update-v2__description, span[dir="ltr"]');
      if (textNode) {
          postText = textNode.innerText.trim();
      }

      // Improved extraction using text boundaries, as classes often obfuscate in new LinkedIn layout
      const lines = textContent.split('\\n').map(l => l.trim()).filter(Boolean);
      
      let authorName = 'Unknown';
      let authorHeadline = '';
      let bodyStart = 0;
      
      for (let i = 0; i < Math.min(lines.length, 15); i++) {
        const ln = lines[i];
        if (!ln || ln.length > 80 || ln.includes('http')) continue;
        const wc = ln.split(/\\s+/).filter(Boolean).length;
        
        if (!authorName) {
           // Basic heuristics for real name
           if (wc >= 1 && wc <= 8 && ln.length > 2 && !/^(feed|linkedin|unknown|suggested|sponsored|promoted|like|comment|share)/i.test(ln)) {
               authorName = ln;
               bodyStart = i + 1;
           }
        } else if (!authorHeadline && wc <= 14) {
           authorHeadline = ln;
           bodyStart = i + 1;
        } else {
           break;
        }
      }
      
      // Fallback if class matching is completely broken
      if (!postText && lines.length > bodyStart) {
          postText = lines.slice(bodyStart).join(' ').trim();
      }

      // Extract Profile Link
      let profileLink = '';
      const authorLinks = el.querySelectorAll('a[href*="/in/"], a[href*="/company/"]');
      if (authorLinks.length > 0) {
        profileLink = authorLinks[0].getAttribute('href') || '';
        if (profileLink && !profileLink.startsWith('http')) {
            profileLink = 'https://www.linkedin.com' + profileLink.split('?')[0];
        }
      }

      // Extract Image URL
      let imageUrl = '';
      const imgNode = el.querySelector('img.update-components-image__image, img.ivm-view-attr__img--centered');
      if (imgNode) {
          imageUrl = imgNode.getAttribute('src') || '';
      }

      // Extract Video URL if Image not found
      if(!imageUrl) {
         const videoNode = el.querySelector('video');
         if(videoNode) imageUrl = 'Video Content';
      }

      // Extract Post Link
      let postLink = '';
      // It's often difficult to get the exact share link from the DOM without clicking "Copy link to post",
      // But we can construct it if we have the activity URN
      const activityMatch = urn.match(/activity[:\-](\d+)/);
      if (activityMatch) {
          postLink = `https://www.linkedin.com/feed/update/urn:li:activity:${activityMatch[1]}/`;
      } else {
          // Fallback: look for generic anchor containing /posts/ or /history/
          const postAnchor = el.querySelector('a[href*="/posts/"], a[href*="/feed/update/"]');
          if (postAnchor) {
              postLink = postAnchor.getAttribute('href');
              if (postLink && !postLink.startsWith('http')) {
                  postLink = 'https://www.linkedin.com' + postLink.split('?')[0];
              }
          }
      }

      // Extract Metrics (Likes, Comments, Reposts)
      let likes = '0', comments = '0', reposts = '0';
      const metricsNode = el.querySelector('.update-v2-social-activity, .social-details-social-activity');
      if (metricsNode) {
          const metricsText = metricsNode.innerText || '';
          const rxMatch = metricsText.match(/([\d,\.]+\s*[KkMm]?)\s*(?:reactions?|likes?)/i);
          const cxMatch = metricsText.match(/([\d,\.]+\s*[KkMm]?)\s*comments?/i);
          const rpxMatch = metricsText.match(/([\d,\.]+\s*[KkMm]?)\s*reposts?/i);
          
          if(rxMatch) likes = rxMatch[1];
          if(cxMatch) comments = cxMatch[1];
          if(rpxMatch) reposts = rpxMatch[1];
      }

      // Alternate metric fallback (buttons)
      if (likes === '0') {
          const likeBtn = el.querySelector('button.react-button__trigger, .social-actions-button');
          if (likeBtn && likeBtn.innerText) {
             const m = likeBtn.innerText.match(/([\d,\.]+)/);
             if (m) likes = m[1];
          }
      }

      results.push({
        authorName,
        authorHeadline,
        postText,
        imageUrl,
        postLink,
        profileLink,
        likes,
        comments,
        reposts,
        isPromoted
      });
    }

    return results;
  }, maxPosts);

  // Clean counts
  return extracted.map(p => ({
      ...p,
      likes: parseCount(p.likes) || 0,
      comments: parseCount(p.comments) || 0,
      reposts: parseCount(p.reposts) || 0
  }));
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  📊  LinkedIn Feed Analyzer (Powered by Llama 3.1)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let browser, page;
  try {
    // 1. Create Session & Navigate
    console.log('\nInitializing browser session...');
    const sessionOpts = await createSession();
    browser = sessionOpts.browser;
    page = sessionOpts.page;

    // Go to feed
    if (!page.url().includes('linkedin.com/feed')) {
      await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    await sleep(4000);

    // 2. Scroll and Expand
    await scrollFeed(page, 5);
    await clickSeeMore(page);

    // 3. Extract 5 Posts
    const posts = await extractPosts(page, 5);
    console.log(`\nSuccessfully extracted ${posts.length} posts.\n`);

    // 4. Analyze with Ollama and Save to CSV
    const finalData = [];
    for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        console.log(`Analyzing Post ${i + 1} by ${post.authorName}...`);
        
        const analysis = await analyzePostWithOllama(post);
        console.log(`\n  --- AI Analysis ---`);
        console.log(`  ${analysis.replace(/\n/g, '\n  ')}`);
        console.log(`  -------------------\n`);

        finalData.push({
            ...post,
            aiAnalysis: analysis
        });
        
        await sleep(1000); // Small pause between Ollama calls
    }

    // 5. Write to CSV
    if (finalData.length > 0) {
        await csvWriter.writeRecords(finalData);
        console.log(`✅ Saved ${finalData.length} analyzed posts to ${CSV_PATH}`);
    } else {
        console.log('⚠️  No posts extracted.');
    }

    // 6. Wait for user to close
    console.log('\n=================================================');
    console.log('The browser is still open for you to verify.');
    await waitForEnter('Press ENTER to close the browser and exit...\n');
    
    console.log('Closing browser...');
    await browser.close();
    console.log('Done!');
  } catch (error) {
    console.error(`\n[ERROR] ${error.message}`);
    console.error(error.stack);
    try {
      if (browser) await browser.close();
    } catch (_) {}
    process.exit(1);
  }
}

main();
