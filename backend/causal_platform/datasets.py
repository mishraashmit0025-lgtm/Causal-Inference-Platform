"""Simulated demo datasets with known ground-truth effects.

Each generator documents the true effect so estimators can be checked against it.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def minimum_wage_panel(seed: int = 3, n_units: int = 80, n_periods: int = 12, effect: float = -1.5) -> pd.DataFrame:
    """Unit x period panel; half the units adopt a policy at period 7.

    Outcome = unit FE + common time trend + effect * treated_post + noise.
    Parallel trends hold by construction, so DiD recovers ``effect``.
    """
    rng = np.random.default_rng(seed)
    units = np.arange(n_units)
    treated = units < n_units // 2
    alpha = rng.normal(20, 3, n_units) + 2.0 * treated  # level differences are allowed
    gamma = np.linspace(0, 3, n_periods) + rng.normal(0, 0.2, n_periods)
    rows = []
    for u in units:
        for t in range(n_periods):
            post = t >= 7
            y = alpha[u] + gamma[t] + effect * (treated[u] and post) + rng.normal(0, 0.8)
            rows.append((f"region_{u:02d}", t, int(treated[u]), int(post), y))
    return pd.DataFrame(rows, columns=["unit", "period", "treated", "post", "employment"])


def tobacco_tax_states(seed: int = 1, n_states: int = 30, n_years: int = 30, effect: float = -12.0) -> pd.DataFrame:
    """State x year panel where one state introduces a tax in year 19.

    The treated state's untreated outcome is an exact convex combination of three
    donor states plus noise, so synthetic control should recover the post-period gap
    ``effect`` (ramped in over 3 years).
    """
    rng = np.random.default_rng(seed)
    years = np.arange(1970, 1970 + n_years)
    factors = np.cumsum(rng.normal(0, 1, (n_years, 3)), axis=0)
    loads = rng.uniform(0.2, 1.5, (n_states, 3))
    base = 120 - 1.2 * np.arange(n_years)[:, None]
    Y = base + factors @ loads.T + rng.normal(0, 0.6, (n_years, n_states)) * 2
    w = np.array([0.5, 0.3, 0.2])
    Y[:, 0] = Y[:, [3, 7, 11]] @ w + rng.normal(0, 0.5, n_years)
    t0 = 19
    ramp = np.clip((np.arange(n_years) - t0 + 1) / 3, 0, 1)
    Y[:, 0] += effect * ramp
    names = ["California"] + [f"State_{i:02d}" for i in range(1, n_states)]
    rows = [(names[s], int(years[t]), float(Y[t, s])) for s in range(n_states) for t in range(n_years)]
    return pd.DataFrame(rows, columns=["state", "year", "cigsale"])


def job_training_observational(seed: int = 2, n: int = 3000, effect: float = 1800.0) -> pd.DataFrame:
    """Observational job-training data with confounding by age, education and prior earnings.

    Treatment probability depends on the confounders, and earnings depend on them too,
    so the naive difference in means is biased; adjusting recovers ``effect``.
    """
    rng = np.random.default_rng(seed)
    age = rng.integers(18, 55, n)
    educ = rng.integers(8, 17, n)
    married = rng.binomial(1, 0.4, n)
    re74 = np.maximum(0, rng.normal(9000, 6000, n) + 250 * (educ - 12))
    logit = 1.5 - 0.05 * (age - 30) - 0.2 * (educ - 12) - 0.00015 * (re74 - 9000) - 0.4 * married
    treat = rng.binomial(1, 1 / (1 + np.exp(-logit)))
    re78 = 3000 + 120 * age + 600 * educ + 0.55 * re74 + 900 * married + effect * treat + rng.normal(0, 2500, n)
    return pd.DataFrame(dict(age=age, educ=educ, married=married, re74=re74.round(2), treat=treat, re78=re78.round(2)))


DATASETS = {
    "minimum_wage_panel": dict(
        loader=minimum_wage_panel, method="did", true_effect=-1.5,
        description="80 regions x 12 periods; half adopt a policy at period 7 (true effect -1.5).",
        defaults=dict(unit="unit", time="period", outcome="employment", treated="treated", post="post"),
    ),
    "tobacco_tax_states": dict(
        loader=tobacco_tax_states, method="synth", true_effect=-12.0,
        description="30 states x 30 years; 'California' taxes tobacco from 1989 (true effect -12 after ramp).",
        defaults=dict(unit="state", time="year", outcome="cigsale", treated_unit="California", treatment_time=1989),
    ),
    "job_training_observational": dict(
        loader=job_training_observational, method="psm", true_effect=1800.0,
        description="3,000 workers; enrollment confounded by age, education, earnings (true effect 1800).",
        defaults=dict(treatment="treat", outcome="re78", covariates=["age", "educ", "married", "re74"]),
    ),
}
