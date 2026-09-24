"""Difference-in-differences: two-way fixed effects with cluster-robust SEs plus an event study."""
from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf


def _clean(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValueError(f"columns not found: {missing}")
    return df.dropna(subset=cols).copy()


def difference_in_differences(
    df: pd.DataFrame, unit: str, time: str, outcome: str, treated: str, post: str, alpha: float = 0.05
) -> dict:
    d = _clean(df, [unit, time, outcome, treated, post])
    d["_y"], d["_d"] = d[outcome].astype(float), (d[treated].astype(int) * d[post].astype(int))
    if d["_d"].nunique() < 2:
        raise ValueError("need both treated-post and other observations")

    # 2x2 means table (the textbook estimator)
    means = d.groupby([treated, post])["_y"].mean()
    did_2x2 = (means[(1, 1)] - means[(1, 0)]) - (means[(0, 1)] - means[(0, 0)])

    # TWFE regression with unit + time fixed effects, SEs clustered by unit
    d["_u"], d["_t"] = d[unit].astype(str), d[time].astype(str)
    fit = smf.ols("_y ~ _d + C(_u) + C(_t)", data=d).fit(
        cov_type="cluster", cov_kwds={"groups": pd.factorize(d["_u"])[0]}
    )
    lo, hi = fit.conf_int(alpha).loc["_d"]

    # event study: coefficients on leads/lags relative to the first treated period (ref = -1)
    first_post = d.loc[d[post].astype(int) == 1, time].min()
    periods = np.sort(d[time].unique())
    rel = {p: int(np.searchsorted(periods, p) - np.searchsorted(periods, first_post)) for p in periods}
    d["_rel"] = d[time].map(rel)
    event = []
    terms = []
    for k in sorted(set(rel.values())):
        if k == -1:
            continue
        name = f"ev_{'m' if k < 0 else 'p'}{abs(k)}"
        d[name] = ((d["_rel"] == k) & (d[treated].astype(int) == 1)).astype(int)
        terms.append((k, name))
    es = smf.ols("_y ~ " + " + ".join(n for _, n in terms) + " + C(_u) + C(_t)", data=d).fit(
        cov_type="cluster", cov_kwds={"groups": pd.factorize(d["_u"])[0]}
    )
    ci = es.conf_int(alpha)
    for k, name in terms:
        event.append(dict(rel_time=k, coef=float(es.params[name]), lo=float(ci.loc[name, 0]), hi=float(ci.loc[name, 1])))
    event.append(dict(rel_time=-1, coef=0.0, lo=0.0, hi=0.0))
    event.sort(key=lambda e: e["rel_time"])

    # joint test that all pre-period coefficients are zero (parallel trends check)
    pre = [n for k, n in terms if k < -1]
    pretrend_p = float(es.f_test(", ".join(f"{n} = 0" for n in pre)).pvalue) if pre else None

    trends = (
        d.groupby([time, treated])["_y"].mean().unstack(treated).rename(columns={0: "control", 1: "treated"}).reset_index()
    )
    return {
        "method": "difference_in_differences",
        "estimate": float(fit.params["_d"]),
        "std_error": float(fit.bse["_d"]),
        "ci": [float(lo), float(hi)],
        "p_value": float(fit.pvalues["_d"]),
        "did_2x2": float(did_2x2),
        "pretrend_p_value": pretrend_p,
        "n_obs": int(len(d)),
        "n_units": int(d[unit].nunique()),
        "treatment_start": first_post.item() if hasattr(first_post, "item") else first_post,
        "trends": [
            {"time": r[time].item() if hasattr(r[time], "item") else r[time], "treated": float(r["treated"]), "control": float(r["control"])}
            for _, r in trends.iterrows()
        ],
        "event_study": event,
    }
