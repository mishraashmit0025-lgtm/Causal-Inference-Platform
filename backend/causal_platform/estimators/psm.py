"""Propensity score matching via DoWhy, plus balance and overlap diagnostics."""
from __future__ import annotations

import logging
import warnings

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import NearestNeighbors

logging.getLogger("dowhy").setLevel(logging.WARNING)


def _smd(x_t: np.ndarray, x_c: np.ndarray) -> float:
    sd = np.sqrt((x_t.var(ddof=1) + x_c.var(ddof=1)) / 2)
    return float((x_t.mean() - x_c.mean()) / sd) if sd > 0 else 0.0


def propensity_score_matching(
    df: pd.DataFrame, treatment: str, outcome: str, covariates: list[str],
    target: str = "att", refute: bool = True, bins: int = 25,
) -> dict:
    from dowhy import CausalModel

    cols = [treatment, outcome, *covariates]
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValueError(f"columns not found: {missing}")
    d = df.dropna(subset=cols).copy()
    d[treatment] = d[treatment].astype(bool)
    if d[treatment].nunique() != 2:
        raise ValueError("treatment must be binary with both groups present")
    if target not in ("att", "ate", "atc"):
        raise ValueError("target must be att, ate or atc")

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = CausalModel(data=d, treatment=treatment, outcome=outcome, common_causes=covariates)
        estimand = model.identify_effect(proceed_when_unidentifiable=True)
        est = model.estimate_effect(estimand, method_name="backdoor.propensity_score_matching", target_units=target)
        refutation = None
        if refute:
            r = model.refute_estimate(estimand, est, method_name="placebo_treatment_refuter",
                                      placebo_type="permute", num_simulations=20)
            refutation = {"placebo_effect": float(r.new_effect),
                          "p_value": float(r.refutation_result["p_value"]) if r.refutation_result else None}

    # diagnostics computed with the same logistic propensity model DoWhy uses by default
    X = d[covariates].to_numpy(float)
    Xs = (X - X.mean(0)) / np.where(X.std(0) > 0, X.std(0), 1)
    t = d[treatment].to_numpy()
    ps = LogisticRegression(max_iter=1000).fit(Xs, t).predict_proba(Xs)[:, 1]
    nn = NearestNeighbors(n_neighbors=1).fit(ps[~t].reshape(-1, 1))
    match_idx = nn.kneighbors(ps[t].reshape(-1, 1), return_distance=False)[:, 0]
    Xc_matched = X[~t][match_idx]

    balance = [
        {"covariate": c, "smd_before": _smd(X[t, i], X[~t, i]), "smd_after": _smd(X[t, i], Xc_matched[:, i])}
        for i, c in enumerate(covariates)
    ]
    edges = np.linspace(0, 1, bins + 1)
    hist = [
        {"bin_start": float(edges[i]), "bin_end": float(edges[i + 1]),
         "treated": int(((ps[t] >= edges[i]) & (ps[t] < edges[i + 1] + (i == bins - 1))).sum()),
         "control": int(((ps[~t] >= edges[i]) & (ps[~t] < edges[i + 1] + (i == bins - 1))).sum())}
        for i in range(bins)
    ]
    y = d[outcome].to_numpy(float)
    return {
        "method": "propensity_score_matching",
        "target": target,
        "estimate": float(est.value),
        "naive_difference": float(y[t].mean() - y[~t].mean()),
        "n_treated": int(t.sum()),
        "n_control": int((~t).sum()),
        "balance": balance,
        "propensity_hist": hist,
        "common_support": [float(max(ps[t].min(), ps[~t].min())), float(min(ps[t].max(), ps[~t].max()))],
        "refutation": refutation,
    }
