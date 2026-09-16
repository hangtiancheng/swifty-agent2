"""ch10 ONNX export: torch model -> onnx (variable batch/seq), then run the test set to verify the
ONNX predictions match torch exactly. Note: torch 2.9+'s torch.onnx.export defaults to dynamo=True;
for HF models we explicitly pass dynamo=False to take the stable TorchScript exporter + dynamic_axes
route. Run: make ch10-export.

Vendored Python (torch -> ONNX). Writes reports/export_report.json for the acceptance page
(/acceptance): checked count, mismatch count, artifact size.
"""

import datetime as dt
import json
import pathlib
import shutil
from typing import cast

import numpy as np
import onnxruntime as ort
import torch
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    PreTrainedModel,
)

MODEL_DIR = pathlib.Path("data/train/model")
OUT = pathlib.Path("data/train/onnx")
TEST = pathlib.Path("data/train/dataset/test.jsonl")
REPORTS = pathlib.Path("data/train/reports")


def _write_report(checked: int, mismatch: int) -> None:
    """Persist the consistency-check verdict; write it even on failure so the acceptance page can
    show "the last export did not pass" rather than a blank screen."""
    onnx_path = OUT / "model.onnx"
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "export_report.json").write_text(
        json.dumps(
            {
                "ran_at": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
                "checked": checked,
                "mismatch": mismatch,
                "passed": mismatch == 0,
                "onnx_path": str(onnx_path),
                "onnx_bytes": onnx_path.stat().st_size if onnx_path.exists() else 0,
                "opset": 17,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


class LogitsWrapper(torch.nn.Module):
    """The HF model outputs a ModelOutput dict; wrap it to return only the logits tensor for export."""

    def __init__(self, model: PreTrainedModel) -> None:
        super().__init__()
        self.model = model

    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: torch.Tensor,
        token_type_ids: torch.Tensor,
    ) -> torch.Tensor:
        out = self.model(
            input_ids=input_ids,
            attention_mask=attention_mask,
            token_type_ids=token_type_ids,
        )
        return cast(torch.Tensor, out.logits)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR)
    model.eval()
    wrapper = LogitsWrapper(model)
    sample = tokenizer(
        ["bought it too big want to return", "where is my package"],
        padding=True,
        return_tensors="pt",
    )
    dyn = {0: "batch", 1: "seq"}
    torch.onnx.export(
        wrapper,
        (sample["input_ids"], sample["attention_mask"], sample["token_type_ids"]),
        str(OUT / "model.onnx"),
        input_names=["input_ids", "attention_mask", "token_type_ids"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": dyn,
            "attention_mask": dyn,
            "token_type_ids": dyn,
            "logits": {0: "batch"},
        },
        dynamo=False,
        opset_version=17,
    )
    tokenizer.save_pretrained(OUT)  # brings out tokenizer.json for the light runtime
    shutil.copy(MODEL_DIR / "threshold.json", OUT / "threshold.json")

    # Consistency check: the full test set; the ONNX and torch above-line labels must match exactly.
    # The reference model must be reloaded: tracing bakes transformers v5 masking_utils branches into
    # constants and pollutes the in-process model (the polluted reference logits differed by 1.88 in
    # practice, while the file itself was fine).
    ref = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR)
    ref.eval()
    threshold = json.loads((OUT / "threshold.json").read_text())["threshold"]
    texts: list[str] = [
        json.loads(l)["text"]
        for l in TEST.read_text(encoding="utf-8").splitlines()
        if l.strip()
    ]
    sess = ort.InferenceSession(
        str(OUT / "model.onnx"), providers=["CPUExecutionProvider"]
    )
    mismatch = 0
    with torch.no_grad():
        for i in range(0, len(texts), 32):
            enc = tokenizer(
                texts[i : i + 32],
                truncation=True,
                padding=True,
                max_length=128,
                return_tensors="pt",
            )
            t_logits = ref(**enc).logits.numpy()
            (o_logits,) = sess.run(["logits"], {k: v.numpy() for k, v in enc.items()})
            assert np.allclose(t_logits, o_logits, atol=1e-3), "logits exceed tolerance"
            t_pred = 1 / (1 + np.exp(-t_logits)) >= threshold
            o_pred = 1 / (1 + np.exp(-o_logits)) >= threshold
            mismatch += int((t_pred != o_pred).any(axis=1).sum())
    _write_report(len(texts), mismatch)
    if mismatch:
        raise SystemExit(
            f"ONNX and torch predictions differ on {mismatch} rows; export failed"
        )
    print(
        f"ONNX exported and verified ({len(texts)} predictions match exactly): {OUT}/model.onnx"
    )


if __name__ == "__main__":
    main()
