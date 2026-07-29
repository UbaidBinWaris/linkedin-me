import json
from .llm_client import llm_client

class CommentAnalyzerAgent:
    """
    Agent 2 — Comment Analyzer
    Analyzes LinkedIn comments for sentiment, intent, quality, CTA presence, and spam detection.
    """
    SYSTEM_PROMPT = """You are an expert NLP Comment Analyzer. Analyze the given LinkedIn comment and output JSON strictly in this format:
{
    "sentiment": "positive | neutral | negative",
    "emotion": "curious | supportive | skeptical | professional | humorous",
    "intent": "question | praise | feedback | networking | spam",
    "quality_score": 0-100,
    "has_question": true/false,
    "has_cta": true/false,
    "is_spam": true/false,
    "summary": "Short 1-sentence summary"
}
Output only valid JSON without markdown wrapping."""

    def analyze_comment(self, comment_text: str) -> dict:
        if not comment_text or len(comment_text.strip()) == 0:
            return {"error": "Empty comment text"}
            
        raw_res = llm_client.chat_completion(
            prompt=f"Comment: {comment_text}",
            system_prompt=self.SYSTEM_PROMPT,
            temperature=0.2
        )
        
        try:
            cleaned = raw_res.replace("```json", "").replace("```", "").strip()
            return json.loads(cleaned)
        except Exception:
            return {
                "sentiment": "neutral",
                "emotion": "professional",
                "intent": "feedback",
                "quality_score": 50,
                "has_question": "?" in comment_text,
                "has_cta": False,
                "is_spam": False,
                "raw_response": raw_res
            }

comment_analyzer = CommentAnalyzerAgent()
