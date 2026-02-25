'use strict';

/**
 * commentStyles.js — Modular comment writing strategies
 *
 * Each style tells the AI HOW to write the comment.
 * A random style is picked each run so your comments feel varied.
 *
 * To add your own style: push a new object into COMMENT_STYLES.
 */

const COMMENT_STYLES = [
  {
    id: 'experiential',
    label: 'Share Personal Experience',
    instruction:
      'Reference a real, specific experience you have had as a developer that relates to this post. ' +
      'Be concrete — mention a tech, project type, or scenario. Do NOT be generic.',
  },
  {
    id: 'contrarian',
    label: 'Gentle Contrarian Take',
    instruction:
      'Disagree with or add nuance to a point in the post in a respectful, intellectual way. ' +
      'Say why you see it differently based on your own developer experience.',
  },
  {
    id: 'analytical',
    label: 'Add Analytical Depth',
    instruction:
      'Pick the most interesting technical or business claim in the post and expand on WHY it works or ' +
      'what the trade-offs are. Add one insight the author did not mention.',
  },
  {
    id: 'question',
    label: 'Thoughtful Question',
    instruction:
      'Ask a single, specific, genuinely curious question that digs deeper into one aspect of the post. ' +
      'The question should show you actually read and understood the content.',
  },
  {
    id: 'parallel',
    label: 'Draw a Parallel',
    instruction:
      'Connect what the author described to a pattern you have seen in software engineering, ' +
      'team dynamics, or product development. Make the parallel explicit and specific.',
  },
  {
    id: 'builder',
    label: 'Builder Perspective',
    instruction:
      'React from the perspective of someone who has built or shipped a real product. ' +
      'What would this mean in practice when building? What would you do differently?',
  },
];

/**
 * Picks one comment style at random.
 * @returns {{ id, label, instruction }}
 */
function pickRandomStyle() {
  return COMMENT_STYLES[Math.floor(Math.random() * COMMENT_STYLES.length)];
}

module.exports = { COMMENT_STYLES, pickRandomStyle };
