'use strict';
/**
 * commentStyles.js — 6 comment writing strategies with session-level Style Memory.
 *
 * Style memory prevents the same style from being used consecutively.
 * The last 3 used style IDs are tracked per process run.
 */

const COMMENT_STYLES = [
  {
    id:          'experiential',
    label:       'Share Personal Experience',
    instruction: `Reference a real, specific experience from your work as a developer, builder, or automation engineer.
Use concrete detail (a tool, a situation, a result) — not generic advice.
Example pattern: "When I built [X], I ran into exactly this — what helped was [Y]."
Keep it to 1-2 sentences. First person, genuine, no filler.`,
  },
  {
    id:          'contrarian',
    label:       'Gentle Contrarian Take',
    instruction: `Disagree with or add nuance to the post — respectfully and with a reason.
State what you agree with first, then pivot to the thing that's often missed or oversimplified.
Example pattern: "This is true for [X] — though in my experience, [counterpoint]."
Must be respectful. Never dismissive. 1-2 sentences.`,
  },
  {
    id:          'analytical',
    label:       'Add Analytical Depth',
    instruction: `Expand on a trade-off, second-order effect, or nuance the author didn't explore.
Think like an engineer reviewing a technical decision: what are the edge cases? What scales? What fails?
1-2 sentences. Add signal, not just agreement.`,
  },
  {
    id:          'question',
    label:       'Seeking Clarification',
    instruction: `ONLY ask a question if the post contains incomplete/mismatched info, or introduces new tech needing explanation.
If it does, ask ONE specific, curious question that shows you read and thought about it.
If not, just provide a simple, insightful reaction.
1-2 sentences. Genuine curiosity, not rhetorical.`,
  },
  {
    id:          'parallel',
    label:       'Draw a Parallel',
    instruction: `Connect the author's point to a pattern you've seen in software engineering, systems design, or automation.
Use concrete domain language. Show you see the bigger principle behind the post.
Example: "This mirrors [known concept/pattern] — [why it's similar and why it matters]."
1-2 sentences.`,
  },
  {
    id:          'builder',
    label:       'Builder Perspective',
    instruction: `React as someone who has shipped a real product or automation. Be specific about what worked or didn't.
Show you've been in the trenches — reference a real outcome, number, or scenario.
Example: "Shipped something similar last [year/quarter] — the real challenge was [X], not [Y the author implied]."
1-2 sentences. Confident, grounded.`,
  },
];

// ─────────────────────────────────────────────────────────────────
//  COMMENT TYPES (Weight Distribution)
// ─────────────────────────────────────────────────────────────────

const COMMENT_TYPES = [
  { id: 'simple_reaction', weight: 25, label: 'Simple Reaction' },
  { id: 'agreement',       weight: 20, label: 'Agreement' },
  { id: 'micro_insight',   weight: 20, label: 'Micro Insight' },
  { id: 'mini_story',      weight: 10, label: 'Mini Story' },
  { id: 'curious_question',weight: 10, label: 'Curious Question' },
  { id: 'builder_feedback',weight: 10, label: 'Builder Feedback' },
  { id: 'supportive',      weight: 5,  label: 'Supportive' },
  { id: 'celebratory',     weight: 5,  label: 'Celebratory' }
];

function pickRandomType() {
  const totalWeight = COMMENT_TYPES.reduce((sum, t) => sum + t.weight, 0);
  let random = Math.floor(Math.random() * totalWeight);
  
  for (const type of COMMENT_TYPES) {
    if (random < type.weight) return type;
    random -= type.weight;
  }
  return COMMENT_TYPES[0]; // Fallback
}

// ─────────────────────────────────────────────────────────────────
//  STYLE MEMORY — tracks last 5 styles used this session
// ─────────────────────────────────────────────────────────────────

const recentStyleIds = [];  // persists in memory per process run

/**
 * Picks a random style, avoiding the last 5 used ones (if pool is large enough).
 * Also randomizes pick probability implicitly instead of pure uniform distribution.
 * @returns {{ id, label, instruction }}
 */
function pickRandomStyle() {
  const available = COMMENT_STYLES.filter((s) => !recentStyleIds.includes(s.id));
  const pool = available.length > 0 ? available : COMMENT_STYLES;

  // Randomize probabilities instead of uniform math.floor
  const weightedPool = pool.map(style => ({
    style,
    randWeight: Math.random() // dynamic randomized weight per run
  }));
  weightedPool.sort((a, b) => b.randWeight - a.randWeight);

  const picked = weightedPool[0].style;

  // Remember this style; keep at most 5 interactions
  recentStyleIds.push(picked.id);
  if (recentStyleIds.length > 5) recentStyleIds.shift();

  return picked;
}

/**
 * Returns the style memory (for logging).
 */
function getStyleMemory() {
  return [...recentStyleIds];
}

module.exports = { 
  COMMENT_STYLES, 
  COMMENT_TYPES, 
  pickRandomStyle, 
  pickRandomType, 
  getStyleMemory 
};
