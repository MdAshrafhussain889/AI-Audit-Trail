MODEL_PRICING = {
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4": {"input": 30.00, "output": 60.00},
    "gpt-3.5-turbo": {"input": 0.50, "output": 1.50},
}

DEFAULT_PRICING = {"input": 0.50, "output": 1.50}


def calculate_cost(model_version: str, prompt_tokens: int, completion_tokens: int) -> float:
    pricing = MODEL_PRICING.get(model_version, DEFAULT_PRICING)
    cost = (
        (prompt_tokens or 0) / 1_000_000 * pricing["input"]
        + (completion_tokens or 0) / 1_000_000 * pricing["output"]
    )
    return round(cost, 6)
