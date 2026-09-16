"""train evaluation: per-class P/R/F1 + per-class confusion matrix + tolerance red lines + error
export on the held-out test set. Run: make train-eval. The eval set is the project's own e-commerce
scenario (dataset/test.jsonl), not a public leaderboard.

Vendored Python (reads the torch weights). Artifacts come in pairs: .md for humans, .json for the
acceptance page (/acceptance/eval, /acceptance/errors) — same evaluation, same numbers.

Severity and error-direction enums are English to match the TS taxonomy and acceptance API:
severity strict|medium|lenient; kind missed|misplaced|extra.
"""

import datetime as dt
import json
import pathlib
from typing import Any

import numpy as np
import numpy.typing as npt
import torch
from inference_lib import apply_threshold
from sklearn.metrics import multilabel_confusion_matrix, precision_recall_fscore_support
from taxonomy import LABEL2ID, NUM_CLASSES, SEVERITY, TOPIC_NAMES
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    PreTrainedTokenizerBase,
)

MODEL_DIR = pathlib.Path("data/train/model")
TEST = pathlib.Path("data/train/dataset/test.jsonl")
REPORTS = pathlib.Path("data/train/reports")
RED_LINES = {"strict": 0.9, "medium": 0.8}  # per-severity F1 red line; lenient has none


def pick_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    return "mps" if torch.backends.mps.is_available() else "cpu"


def predict(
    model: torch.nn.Module,  # only eval()+forward() are used; nn.Module.eval is typed (transformers' override is not)
    tokenizer: PreTrainedTokenizerBase,
    texts: list[str],
    threshold: float,
    device: str,
) -> npt.NDArray[Any]:
    model.eval()
    probs_all: list[npt.NDArray[Any]] = []
    with torch.no_grad():
        for i in range(0, len(texts), 32):
            enc = tokenizer(
                texts[i : i + 32],
                truncation=True,
                padding=True,
                max_length=128,
                return_tensors="pt",
            ).to(device)
            probs_all.append(torch.sigmoid(model(**enc).logits).cpu().numpy())
    return apply_threshold(np.concatenate(probs_all), threshold)


def main() -> None:
    device = pick_device()
    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR).to(device)
    threshold: float = json.loads((MODEL_DIR / "threshold.json").read_text())[
        "threshold"
    ]
    samples: list[dict[str, Any]] = [
        json.loads(l)
        for l in TEST.read_text(encoding="utf-8").splitlines()
        if l.strip()
    ]
    texts: list[str] = [s["text"] for s in samples]
    gold = np.zeros((len(samples), NUM_CLASSES), dtype=int)
    for i, s in enumerate(samples):
        for lb in s["labels"]:
            gold[i][LABEL2ID[lb]] = 1
    preds = predict(model, tokenizer, texts, threshold, device)

    p, r, f1, support = precision_recall_fscore_support(gold, preds, zero_division=0)
    micro_p, micro_r, micro_f1, _ = precision_recall_fscore_support(
        gold, preds, average="micro", zero_division=0
    )
    macro_p, macro_r, macro_f1, _ = precision_recall_fscore_support(
        gold, preds, average="macro", zero_division=0
    )
    cms = multilabel_confusion_matrix(gold, preds)

    REPORTS.mkdir(parents=True, exist_ok=True)
    lines = [
        "# train classifier evaluation report (held-out test set)",
        "",
        f"Test set {len(samples)} rows; decision threshold {threshold} (from the validation scan).",
        "",
        (
            f"**micro**: P={micro_p:.3f} R={micro_r:.3f} F1={micro_f1:.3f}  |  "
            f"**macro**: P={macro_p:.3f} R={macro_r:.3f} F1={macro_f1:.3f}"
        ),
        "",
        "## Per-class metrics (tolerance red lines: strict F1 >= 0.9, medium >= 0.8, lenient none)",
        "",
        "| class | severity | P | R | F1 | support | red line |",
        "|---|---|---|---|---|---|---|",
    ]
    for i, name in enumerate(TOPIC_NAMES):
        sev = SEVERITY[name]
        # strict/medium each have a hard red line; lenient is unconstrained — draw — not a checkmark,
        # so readers do not think it also passed some line
        line = RED_LINES.get(sev)
        if line is not None:
            flag = f"{line} {'🔴 below bar, go fix the data' if f1[i] < line else '✅'}"
        else:
            flag = "—"
        lines.append(
            f"| {name} | {sev} | {p[i]:.3f} | {r[i]:.3f} | {f1[i]:.3f} "
            f"| {int(support[i])} | {flag} |"
        )
    lines += ["", "## Per-class confusion matrix (TN FP / FN TP)", ""]
    for i, name in enumerate(TOPIC_NAMES):
        tn, fp = cms[i][0]
        fn, tp = cms[i][1]
        lines.append(f"- **{name}**: TN={tn} FP={fp} FN={fn} TP={tp}")
    (REPORTS / "eval_report.md").write_text("\n".join(lines), encoding="utf-8")

    err = [
        "# train misclassified samples (human review: which class erred? is the gold label itself wrong?)",
        "",
    ]
    errors: list[dict[str, Any]] = []
    for i, s in enumerate(samples):
        pred_labels = [TOPIC_NAMES[j] for j in range(NUM_CLASSES) if preds[i][j]]
        if set(pred_labels) != set(s["labels"]):
            err.append(f"- {s['text']}\n  gold: {s['labels']}  pred: {pred_labels}")
            # Error direction: a miss records only a let-go, an extra records only a false alarm, a
            # misplacement records both — this is why the error-case count and the matrix entries do not
            # match (the acceptance page lays this account out instead of making readers subtract).
            missed = [lb for lb in s["labels"] if lb not in pred_labels]
            extra = [lb for lb in pred_labels if lb not in s["labels"]]
            kind = (
                "misplaced" if missed and extra else ("missed" if missed else "extra")
            )
            errors.append(
                {
                    "text": s["text"],
                    "gold": list(s["labels"]),
                    "pred": pred_labels,
                    "missed": missed,
                    "extra": extra,
                    "kind": kind,
                    "matrix_entries": len(missed) + len(extra),
                }
            )
    (REPORTS / "error_samples.md").write_text("\n".join(err), encoding="utf-8")

    report: dict[str, Any] = {
        "ran_at": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
        "test_size": len(samples),
        "threshold": threshold,
        "red_lines": RED_LINES,
        "micro": {
            "p": round(float(micro_p), 4),
            "r": round(float(micro_r), 4),
            "f1": round(float(micro_f1), 4),
        },
        "macro": {
            "p": round(float(macro_p), 4),
            "r": round(float(macro_r), 4),
            "f1": round(float(macro_f1), 4),
        },
        "classes": [
            {
                "name": name,
                "severity": SEVERITY[name],
                "p": round(float(p[i]), 4),
                "r": round(float(r[i]), 4),
                "f1": round(float(f1[i]), 4),
                "support": int(support[i]),
                "red_line": RED_LINES.get(SEVERITY[name]),
                # lenient has no line -> passed is None, the page draws — not a checkmark
                "passed": (
                    None
                    if SEVERITY[name] not in RED_LINES
                    else bool(f1[i] >= RED_LINES[SEVERITY[name]])
                ),
                "tn": int(cms[i][0][0]),
                "fp": int(cms[i][0][1]),
                "fn": int(cms[i][1][0]),
                "tp": int(cms[i][1][1]),
            }
            for i, name in enumerate(TOPIC_NAMES)
        ],
        "errors": errors,
    }
    report["total_cells"] = len(samples) * NUM_CLASSES
    report["total_fp"] = sum(c["fp"] for c in report["classes"])
    report["total_fn"] = sum(c["fn"] for c in report["classes"])
    report["red_line_passed"] = all(c["passed"] is not False for c in report["classes"])
    (REPORTS / "eval_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"micro-F1 {micro_f1:.4f} / macro-F1 {macro_f1:.4f};"
        f" report and error samples written to {REPORTS}/ (.md + .json)"
    )


if __name__ == "__main__":
    main()
