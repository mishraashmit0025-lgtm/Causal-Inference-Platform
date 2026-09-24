"""Synthetic control (Abadie, Diamond & Hainmueller 2010) with placebo-in-space inference."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize


def _weights(y1_pre: np.ndarray, Y0_pre: np.ndarray) -> np.ndarray:
    """Convex weights minimising pre-period RMSE between treated and donor combination."""
    J = Y0_pre.shape[1]
    obj = lambda w: np.sum((y1_pre - Y0_pre @ w) ** 2)
    grad = lambda w: -2 * Y0_pre.T @ (y1_pre - Y0_pre @ w)
    res = minimize(
        obj, np.full(J, 1 / J), jac=grad, method="SLSQP",
        bounds=[(0, 1)] * J, constraints=[{"type": "eq", "fun": lambda w: w.sum() - 1, "jac": lambda w: np.ones(J)}],
        options={"maxiter": 500, "ftol": 1e-12},
    )
    w = np.clip(res.x, 0, None)
    return w / w.sum()


def _fit(Y: pd.DataFrame, unit, pre_mask: np.ndarray) -> tuple[np.ndarray, np.ndarray, pd.Series]:
    donors = [c for c in Y.columns if c != unit]
    y1, Y0 = Y[unit].to_numpy(), Y[donors].to_numpy()
    w = _weights(y1[pre_mask], Y0[pre_mask])
    synth = Y0 @ w
    return y1, synth, pd.Series(w, index=donors)


def _rmspe(gap: np.ndarray) -> float:
    return float(np.sqrt(np.mean(gap**2)))


def synthetic_control(
    df: pd.DataFrame, unit: str, time: str, outcome: str, treated_unit, treatment_time, placebos: bool = True
) -> dict:
    for c in (unit, time, outcome):
        if c not in df.columns:
            raise ValueError(f"column not found: {c}")
    Y = df.pivot_table(index=time, columns=unit, values=outcome).sort_index().dropna(axis=1)
    if treated_unit not in Y.columns:
        raise ValueError(f"treated unit {treated_unit!r} not found (or has missing periods)")
    times = Y.index.to_numpy()
    pre = times < treatment_time
    if pre.sum() < 3 or (~pre).sum() < 1:
        raise ValueError("need at least 3 pre-treatment periods and 1 post-treatment period")

    y1, synth, w = _fit(Y, treated_unit, pre)
    gap = y1 - synth
    pre_rmspe, post_rmspe = _rmspe(gap[pre]), _rmspe(gap[~pre])
    ratio = post_rmspe / max(pre_rmspe, 1e-12)

    placebo_rows, ratios = [], []
    if placebos:
        for u in Y.columns:
            if u == treated_unit:
                continue
            py1, psyn, _ = _fit(Y.drop(columns=[treated_unit]), u, pre)
            pg = py1 - psyn
            pr = _rmspe(pg[pre])
            ratios.append(_rmspe(pg[~pre]) / max(pr, 1e-12))
            # drop poorly-fitting placebos from the plot, as in ADH (pre-RMSPE > 5x treated)
            if pr <= 5 * pre_rmspe:
                placebo_rows.append({"unit": str(u), "gap": [float(v) for v in pg]})
    p_value = (1 + sum(r >= ratio for r in ratios)) / (1 + len(ratios)) if placebos else None

    tv = lambda t: t.item() if hasattr(t, "item") else t
    return {
        "method": "synthetic_control",
        "estimate": float(gap[~pre].mean()),
        "pre_rmspe": pre_rmspe,
        "post_rmspe": post_rmspe,
        "rmspe_ratio": float(ratio),
        "p_value": p_value,
        "treatment_time": tv(treatment_time),
        "weights": [{"unit": str(k), "weight": float(v)} for k, v in w.sort_values(ascending=False).items() if v > 1e-3],
        "series": [
            {"time": tv(t), "treated": float(a), "synthetic": float(b), "gap": float(a - b)}
            for t, a, b in zip(times, y1, synth)
        ],
        "placebos": placebo_rows,
    }
