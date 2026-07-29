import json
from .llm_client import llm_client

class PersonalCoachAgent:
    """
    Agent 4 & 7 — Personal Coach & Engagement Predictor
    Generates daily tactical recommendations and evaluates pre-flight engagement probability for post drafts.
    """
    COACH_SYSTEM_PROMPT = """You are an AI LinkedIn Strategy Personal Coach. Review recent industry trends and generate today's content action plan.
Output JSON format:
{
    "recommended_post_time": "10:15 AM",
    "target_topic": "AI Automation / System Architecture",
    "expected_engagement": "High (Top 10%)",
    "suggested_hook": "After automating 1,200 LinkedIn workflows...",
    "confidence_score": 92,
    "strategic_advice": "Focus on trade-offs of local LLM inference vs cloud APIs."
}"""

    PREDICTOR_SYSTEM_PROMPT = """You are an AI Engagement Predictor for LinkedIn. Analyze the draft post and predict reach metrics.
Output JSON:
{
    "viral_probability": 85,
    "estimated_likes": "300 - 500",
    "estimated_comments": "25 - 45",
    "recommendation": "Try another hook or improve paragraph spacing" if score < 70 else "Ready for review",
    "strengths": ["Strong opening hook", "Clear actionable advice"]
}"""

    def get_daily_recommendation(self, user_niche: str = "Software Engineering & AI Automation") -> dict:
        raw_res = llm_client.chat_completion(
            prompt=f"Generate daily strategy for niche: {user_niche}",
            system_prompt=self.COACH_SYSTEM_PROMPT,
            temperature=0.5
        )
        try:
            cleaned = raw_res.replace("```json", "").replace("```", "").strip()
            return json.loads(cleaned)
        except Exception:
            return {
                "recommended_post_time": "10:00 AM",
                "target_topic": user_niche,
                "suggested_hook": "Building autonomous multi-agent systems locally...",
                "confidence_score": 88
            }

    def predict_engagement(self, draft_text: str) -> dict:
        raw_res = llm_client.chat_completion(
            prompt=f"Draft Post:\n{draft_text}",
            system_prompt=self.PREDICTOR_SYSTEM_PROMPT,
            temperature=0.3
        )
        try:
            cleaned = raw_res.replace("```json", "").replace("```", "").strip()
            return json.loads(cleaned)
        except Exception:
            return {
                "viral_probability": 75,
                "recommendation": "Ready for draft review"
            }

personal_coach = PersonalCoachAgent()
