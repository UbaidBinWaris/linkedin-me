import json
from .llm_client import llm_client

class PostWriterAgent:
    """
    Agent 5 & 6 — Post Writer & Comment Generator
    Generates high-value posts and comments as DRAFT items matching personal voice rules.
    """
    POST_WRITER_SYSTEM_PROMPT = """You are an expert LinkedIn Post Ghostwriter for a senior software engineer and AI automation specialist.
Rules:
- Write in a natural, authentic, professional voice.
- Hook first: Strong single opening sentence that grabs attention.
- Concise: Max 150-250 words.
- Value-packed: Focus on practical lessons, architecture insights, or automation wins.
- Clean formatting: Bullet points or short paragraphs.
- No corporate jargon, no fluff, minimal emojis (0-2 max).
- End with a thought-provoking discussion question.

Output JSON:
{
    "hook": "Opening hook sentence",
    "content": "Full post text",
    "suggested_topics": ["topic1", "topic2"],
    "target_audience": "CTOs / Engineers / Founders"
}"""

    COMMENT_GENERATOR_SYSTEM_PROMPT = """You are a human software engineer commenting on a LinkedIn post.
Rules:
- 1 to 2 sentences maximum (under 180 characters).
- Pick ONE specific point or trade-off from the post.
- Sound conversational, experienced, and human.
- NO emojis, NO hashtags, NO generic openers ("Great post!", "Awesome points!").
- Do NOT flatter the author.

Output JSON:
{
    "comment_text": "The exact comment to post",
    "style": "Share Experience / Analytical Depth / Gentle Contrarian",
    "predicted_engagement": 0-100
}"""

    def generate_post_draft(self, topic: str, target_audience: str = "Engineering Leaders") -> dict:
        prompt = f"Topic: {topic}\nTarget Audience: {target_audience}"
        raw_res = llm_client.chat_completion(
            prompt=prompt,
            system_prompt=self.POST_WRITER_SYSTEM_PROMPT,
            temperature=0.7
        )
        try:
            cleaned = raw_res.replace("```json", "").replace("```", "").strip()
            data = json.loads(cleaned)
            data["status"] = "DRAFT"
            return data
        except Exception:
            return {
                "hook": topic,
                "content": raw_res,
                "status": "DRAFT"
            }

    def generate_comment_draft(self, post_text: str, author_name: str = "") -> dict:
        prompt = f"Post by {author_name}:\n{post_text}"
        raw_res = llm_client.chat_completion(
            prompt=prompt,
            system_prompt=self.COMMENT_GENERATOR_SYSTEM_PROMPT,
            temperature=0.6
        )
        try:
            cleaned = raw_res.replace("```json", "").replace("```", "").strip()
            data = json.loads(cleaned)
            data["status"] = "DRAFT"
            return data
        except Exception:
            return {
                "comment_text": raw_res.strip(),
                "style": "Builder Perspective",
                "status": "DRAFT"
            }

post_writer = PostWriterAgent()
