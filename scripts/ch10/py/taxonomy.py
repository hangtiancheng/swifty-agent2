"""ch10 taxonomy loader for the vendored Python training side.

The authoritative taxonomy lives in src/core/taxonomy.ts (TypeScript). The corpus build step
(scripts/ch10/build-corpus.ts) exports it to data/train/taxonomy.json; this module reads that
artifact so label ids, names and severity come from a single source of truth and cannot drift.
Run `make ch10-corpus` before train/evaluate/export.
"""

import json
import pathlib
from typing import Literal, TypedDict, cast

# Severity drives the per-class tolerance gate; the exact string set is fixed by src/core/taxonomy.ts.
Severity = Literal["strict", "medium", "lenient"]


class _TaxonomyJson(TypedDict):
    """The slice of data/train/taxonomy.json this module consumes (written by build-corpus.ts)."""

    names: list[str]
    label2id: dict[str, int]
    severity: dict[str, Severity]


_TAXONOMY = (
    pathlib.Path(__file__).resolve().parents[3] / "data" / "train" / "taxonomy.json"
)


def _load() -> _TaxonomyJson:
    if not _TAXONOMY.exists():
        raise SystemExit(
            f"{_TAXONOMY} not found. Run `make ch10-corpus` first — it exports the authoritative "
            "taxonomy from src/core/taxonomy.ts for the Python training side to consume."
        )
    # json.loads is Any; the artifact shape is guaranteed by the TS exporter, so assert it statically.
    return cast("_TaxonomyJson", json.loads(_TAXONOMY.read_text(encoding="utf-8")))


_data: _TaxonomyJson = _load()
TOPIC_NAMES: tuple[str, ...] = tuple(_data["names"])
LABEL2ID: dict[str, int] = _data["label2id"]
ID2LABEL: dict[int, str] = {i: n for i, n in enumerate(TOPIC_NAMES)}
NUM_CLASSES: int = len(TOPIC_NAMES)
SEVERITY: dict[str, Severity] = _data["severity"]
