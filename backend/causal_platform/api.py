"""FastAPI service exposing the estimators, demo datasets and CSV upload."""
from __future__ import annotations

import io
import uuid
from pathlib import Path
from typing import Literal

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .datasets import DATASETS
from .estimators.did import difference_in_differences
from .estimators.psm import propensity_score_matching
from .estimators.synth import synthetic_control

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_UPLOADS = 50

app = FastAPI(title="Causal Inference Platform", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])

_uploads: dict[str, pd.DataFrame] = {}
_demo_cache: dict[str, pd.DataFrame] = {}


def get_frame(dataset: str) -> pd.DataFrame:
    if dataset in DATASETS:
        if dataset not in _demo_cache:
            _demo_cache[dataset] = DATASETS[dataset]["loader"]()
        return _demo_cache[dataset]
    if dataset in _uploads:
        return _uploads[dataset]
    raise HTTPException(404, f"unknown dataset {dataset!r}")


def _describe(df: pd.DataFrame) -> dict:
    return {
        "n_rows": int(len(df)),
        "columns": [{"name": c, "dtype": str(df[c].dtype), "n_unique": int(df[c].nunique())} for c in df.columns],
        "preview": df.head(8).to_dict(orient="records"),
    }


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/datasets")
def list_datasets():
    demos = [
        {"id": k, "method": v["method"], "description": v["description"], "true_effect": v["true_effect"], "defaults": v["defaults"]}
        for k, v in DATASETS.items()
    ]
    ups = [{"id": k, "method": None, "description": f"uploaded CSV ({len(v)} rows)", "true_effect": None, "defaults": {}}
           for k, v in _uploads.items()]
    return demos + ups


@app.get("/api/datasets/{dataset}")
def describe_dataset(dataset: str):
    return _describe(get_frame(dataset))


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file too large (20 MB max)")
    try:
        df = pd.read_csv(io.BytesIO(raw))
    except Exception as e:
        raise HTTPException(400, f"could not parse CSV: {e}")
    if len(_uploads) >= MAX_UPLOADS:
        _uploads.pop(next(iter(_uploads)))
    ds_id = f"upload_{uuid.uuid4().hex[:8]}"
    _uploads[ds_id] = df
    return {"id": ds_id, **_describe(df)}


class DiDRequest(BaseModel):
    dataset: str
    unit: str
    time: str
    outcome: str
    treated: str
    post: str


class SynthRequest(BaseModel):
    dataset: str
    unit: str
    time: str
    outcome: str
    treated_unit: str
    treatment_time: float
    placebos: bool = True


class PSMRequest(BaseModel):
    dataset: str
    treatment: str
    outcome: str
    covariates: list[str] = Field(min_length=1)
    target: Literal["att", "ate", "atc"] = "att"
    refute: bool = True


def _run(fn, **kw):
    try:
        return fn(**kw)
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.post("/api/did")
def did(req: DiDRequest):
    return _run(difference_in_differences, df=get_frame(req.dataset), **req.model_dump(exclude={"dataset"}))


@app.post("/api/synth")
def synth(req: SynthRequest):
    df = get_frame(req.dataset)
    tt = req.treatment_time
    if pd.api.types.is_integer_dtype(df[req.time]) and float(tt).is_integer():
        tt = int(tt)
    return _run(synthetic_control, df=df, unit=req.unit, time=req.time, outcome=req.outcome,
                treated_unit=req.treated_unit, treatment_time=tt, placebos=req.placebos)


@app.post("/api/psm")
def psm(req: PSMRequest):
    return _run(propensity_score_matching, df=get_frame(req.dataset), **req.model_dump(exclude={"dataset"}))


# Serve the built React app when present (production / Docker image).
_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
