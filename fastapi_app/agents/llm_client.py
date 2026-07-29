import os
import json
import urllib.request
import urllib.error

class LocalLLMClient:
    """
    Client for local CPU inference via Ollama or vLLM (OpenAI-compatible /v1/chat/completions endpoint).
    Optimized for Dual Xeon CPUs on HP Z840.
    """
    def __init__(self):
        self.ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        self.vllm_url = os.getenv("VLLM_BASE_URL", "http://localhost:8000/v1")
        self.default_model = os.getenv("LOCAL_LLM_MODEL", "qwen2.5:14b")

    def chat_completion(self, prompt: str, system_prompt: str = "", model: str = None, temperature: float = 0.7) -> str:
        model = model or self.default_model
        
        # Try Ollama native endpoint first
        try:
            payload = {
                "model": model,
                "prompt": f"{system_prompt}\n\n{prompt}" if system_prompt else prompt,
                "stream": False,
                "options": {
                    "temperature": temperature
                }
            }
            req = urllib.request.Request(
                f"{self.ollama_url}/api/generate",
                data=json.dumps(payload).encode('utf-8'),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=60) as response:
                res = json.loads(response.read().decode('utf-8'))
                return res.get("response", "").strip()
        except Exception as e:
            # Fallback to OpenAI-compatible vLLM endpoint if available
            try:
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": temperature
                }
                req = urllib.request.Request(
                    f"{self.vllm_url}/chat/completions",
                    data=json.dumps(payload).encode('utf-8'),
                    headers={"Content-Type": "application/json"}
                )
                with urllib.request.urlopen(req, timeout=60) as response:
                    res = json.loads(response.read().decode('utf-8'))
                    return res["choices"][0]["message"]["content"].strip()
            except Exception as vllm_err:
                return f"[Local LLM Offline - Please launch Ollama or vLLM]: {str(e)}"

llm_client = LocalLLMClient()
