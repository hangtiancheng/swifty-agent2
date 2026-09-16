"""train training: full-parameter fine-tune of a BERT/RoBERTa encoder, 17-class multi-label
(BCEWithLogitsLoss). Run: make train-train. Device auto-selects cuda->mps->cpu (Trainer picks);
regularization weight_decay + early stopping watch validation micro-F1.

Vendored Python (the JS ecosystem has no equivalent of full-parameter transformer train).
The authoritative taxonomy is read from data/train/taxonomy.json (exported by the TS corpus step),
so label ids/names/severity stay in sync with src/core/taxonomy.ts.

Base model: the corpus is English, so the default is an English encoder. Override with
TRAIN_BASE_MODEL (e.g. a domain or multilingual model). If HF download fails:
HF_ENDPOINT=https://hf-mirror.com make train-train.
"""

import json
import os
import pathlib
from typing import Any, cast

import numpy as np
import torch
from sklearn.metrics import f1_score
from taxonomy import ID2LABEL, LABEL2ID, NUM_CLASSES
from torch.utils.data import Dataset as TorchDataset
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    EarlyStoppingCallback,
    EvalPrediction,
    PreTrainedModel,
    PreTrainedTokenizerBase,
    Trainer,
    TrainerCallback,
    TrainerControl,
    TrainerState,
    TrainingArguments,
    default_data_collator,
)

BASE = os.environ.get("TRAIN_BASE_MODEL", "bert-base-uncased")
DATA = pathlib.Path("data/train/dataset")
OUT = pathlib.Path("data/train/model")


def load_jsonl(path: pathlib.Path) -> list[dict[str, Any]]:
    return [
        json.loads(l)
        for l in path.read_text(encoding="utf-8").splitlines()
        if l.strip()
    ]


def encode(
    samples: list[dict[str, Any]], tokenizer: PreTrainedTokenizerBase
) -> list[dict[str, Any]]:
    enc = tokenizer(
        [s["text"] for s in samples],
        truncation=True,
        padding="max_length",
        max_length=128,
    )
    items: list[dict[str, Any]] = []
    for i, s in enumerate(samples):
        vec = [0.0] * NUM_CLASSES  # float vector: BCEWithLogitsLoss requires it
        for lb in s["labels"]:
            vec[LABEL2ID[lb]] = 1.0
        items.append(
            {
                "input_ids": enc["input_ids"][i],
                "attention_mask": enc["attention_mask"][i],
                "token_type_ids": enc["token_type_ids"][i],
                "labels": vec,
            }
        )
    return items


def compute_metrics(eval_pred: EvalPrediction) -> dict[str, float]:
    logits, labels = eval_pred
    preds = (1 / (1 + np.exp(-logits)) >= 0.5).astype(int)
    return {
        "micro_f1": f1_score(labels, preds, average="micro", zero_division=0),
        "macro_f1": f1_score(labels, preds, average="macro", zero_division=0),
    }


class BestInMemory(TrainerCallback):
    """Keep the best weight snapshot in memory; zero on-disk checkpoints throughout.

    Trainer's save/rotate peaks at 2-3 copies of the weights, which can fill a small disk; instead
    copy the better state_dict to CPU memory on_evaluate, backfill after training, and write once.
    """

    def __init__(self, model: PreTrainedModel) -> None:
        self.model = model
        self.best_metric: float = -1.0
        self.best_state: dict[str, torch.Tensor] | None = None

    def on_evaluate(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        metrics: dict[str, float] | None = None,
        **kwargs: Any,
    ) -> None:
        score = (metrics or {}).get("eval_micro_f1", -1.0)
        if score > self.best_metric:
            self.best_metric = score
            self.best_state = {
                k: v.detach().to("cpu", copy=True)
                for k, v in self.model.state_dict().items()
            }


def main() -> None:
    tokenizer = AutoTokenizer.from_pretrained(BASE)
    model = AutoModelForSequenceClassification.from_pretrained(
        BASE,
        num_labels=NUM_CLASSES,
        problem_type="multi_label_classification",
        id2label=ID2LABEL,
        label2id=LABEL2ID,
    )
    train_ds = encode(load_jsonl(DATA / "train.jsonl"), tokenizer)
    val_ds = encode(load_jsonl(DATA / "val.jsonl"), tokenizer)
    args = TrainingArguments(
        output_dir="data/train/checkpoints",  # training logs only; save_strategy=no writes no weights
        eval_strategy="epoch",  # v5 parameter name, not evaluation_strategy
        save_strategy="no",  # zero on-disk checkpoints; best weights via BestInMemory
        learning_rate=2e-5,
        per_device_train_batch_size=16,
        per_device_eval_batch_size=64,
        num_train_epochs=8,
        weight_decay=0.01,  # regularization against overfitting
        metric_for_best_model="micro_f1",  # EarlyStopping watches it
        greater_is_better=True,
        logging_steps=20,
        report_to="none",
    )
    best_cb = BestInMemory(model)
    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        processing_class=tokenizer,  # v5: tokenizer= was renamed
        data_collator=default_data_collator,
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2), best_cb],
    )
    trainer.train()
    if (
        best_cb.best_state is not None
    ):  # backfill best validation weights (replaces load_best_model_at_end)
        model.load_state_dict(best_cb.best_state)
        print(f"Backfilled best weights: validation micro-F1 {best_cb.best_metric:.4f}")
    # Scan the global best threshold on the validation set (0.30~0.70 step 0.05)
    # val_ds is a plain list used as a map-style dataset; the Trainer stub types it as torch Dataset.
    predictions = trainer.predict(cast(TorchDataset[Any], val_ds)).predictions
    logits = predictions if isinstance(predictions, np.ndarray) else predictions[0]
    probs = 1 / (1 + np.exp(-logits))
    gold = np.array([d["labels"] for d in val_ds])
    best_t, best_f1 = 0.5, -1.0
    for t in np.arange(0.30, 0.71, 0.05):
        f1 = f1_score(gold, (probs >= t).astype(int), average="micro", zero_division=0)
        if f1 > best_f1:
            best_t, best_f1 = round(float(t), 2), float(f1)
    OUT.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(OUT))
    tokenizer.save_pretrained(OUT)
    (OUT / "threshold.json").write_text(
        json.dumps({"threshold": best_t, "val_micro_f1": best_f1})
    )
    print(
        f"Best threshold {best_t}, validation micro-F1 {best_f1:.4f}; model saved to {OUT}"
    )


if __name__ == "__main__":
    main()
