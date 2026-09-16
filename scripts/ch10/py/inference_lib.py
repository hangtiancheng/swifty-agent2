"""ch10 inference pure functions: threshold application and empty-label fallback.

Shared by evaluate.py (Python) and the TS serving path (src/train/inference-lib.ts) — the two
implementations must behave identically. Light dependency (numpy only).
"""

from typing import Any

import numpy as np
import numpy.typing as npt


def apply_threshold(
    probs: npt.NDArray[np.floating[Any]], threshold: float
) -> npt.NDArray[Any]:
    """sigmoid probabilities -> 0/1 multi-label matrix: at/above the line hits; if a row hits
    nothing, fall back to its highest-scoring class so no empty label set is produced."""
    preds = (probs >= threshold).astype(int)
    for r in range(len(preds)):
        if preds[r].sum() == 0:
            preds[r][probs[r].argmax()] = 1
    return preds
