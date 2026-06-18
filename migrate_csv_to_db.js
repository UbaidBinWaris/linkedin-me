const fs = require('fs');
const path = require('path');
const prisma = require('./src/data/db');
const { extractPostId, normalizeLinkedInPostUrl, parseCSVLine } = require('./src/data/csv');
const config = require('./src/config');

async function migrateCsvToDb() {
  const csvPath = path.resolve(config.data.commentedPostsPath);
  if (!fs.existsSync(csvPath)) {
    console.log('CSV file not found at:', csvPath);
    return;
  }

  console.log('Starting migration from CSV to PostgreSQL...');
  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = fileContent.trim().split('\n');

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line);
    // [post_url, author_name, comment_text, commented_at, profile_url]
    const postUrl = cols[0] ? cols[0].replace(/^"|"$/g, '').trim() : '';
    const authorName = cols[1] ? cols[1].replace(/^"|"$/g, '').trim() : '';
    const commentText = cols[2] ? cols[2].replace(/^"|"$/g, '').trim() : '';
    const commentedAtStr = cols[3] ? cols[3].replace(/^"|"$/g, '').trim() : '';

    if (!postUrl) continue;

    const postId = extractPostId(postUrl);
    const normalizedUrl = normalizeLinkedInPostUrl(postUrl);
    const commentedAt = commentedAtStr ? new Date(commentedAtStr) : new Date();

    try {
      await prisma.commentedPost.upsert({
        where: { postId },
        update: {},
        create: {
          postId,
          postUrl: normalizedUrl,
          authorName,
          commentText,
          commentedAt,
        },
      });
      successCount++;
    } catch (err) {
      if (err.code === 'P2002') {
        skipCount++;
      } else {
        console.error(`Error migrating postId ${postId}:`, err.message);
        errorCount++;
      }
    }
  }

  console.log('Migration complete!');
  console.log(`- Successfully migrated/upserted: ${successCount}`);
  console.log(`- Skipped (duplicates): ${skipCount}`);
  console.log(`- Errors: ${errorCount}`);
  
  process.exit(0);
}

migrateCsvToDb();
