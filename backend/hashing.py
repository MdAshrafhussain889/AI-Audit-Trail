import json
import hashlib
from typing import Dict, Any


def compute_hash(entry_fields: Dict[str, Any], prev_hash: str) -> str:
    canonical_json = json.dumps(entry_fields, sort_keys=True)
    combined = canonical_json + prev_hash
    return hashlib.sha256(combined.encode()).hexdigest()
