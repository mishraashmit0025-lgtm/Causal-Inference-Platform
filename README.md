# Causal Inference Platform

A full-stack tool for estimating treatment effects and checking the assumptions behind them. It supports three designs:

| Method | Estimator | Diagnostics |
|---|---|---|
| **Difference-in-differences** | Two-way fixed-effects OLS with unit-clustered SEs, plus the 2×2 means estimator | Event-study leads/lags with 95% CIs; joint F-test of pre-period coefficients (parallel trends) |
| **Synthetic control** | Convex donor weights fit on pre-period outcomes (SLSQP), following Abadie, Diamond & Hainmueller | Placebo-in-space permutation p-value from post/pre RMSPE ratios, gap plot with placebo lines, donor weights |
| **Propensity score matching** | [DoWhy](https://github.com/py-why/dowhy) backdoor PSM (ATT / ATE / ATC) | Propensity overlap histogram, love plot of standardized mean differences before/after matching, DoWhy placebo-treatment refutation |

The backend is **Python** (FastAPI, DoWhy, statsmodels, SciPy). The frontend is **React + TypeScript + D3.js**, with interactive charts that include hover tooltips, resize with the page, and support light and dark themes.

## Demo datasets

Three simulated datasets are included, each with a **known true effect** so you can check that the estimators recover it:

- `minimum_wage_panel`: 80 regions × 12 periods; staggered policy with true effect −1.5
- `tobacco_tax_states`: 30 states × 30 years; one treated state with true effect −12 once fully phased in
- `job_training_observational`: 3,000 workers with confounded enrollment; true ATT is 1,800, while the naive difference in means has the wrong sign

You can also upload your own CSV and map its columns in the sidebar.

## Run it

**Docker**

```bash
docker build -t causal-platform .
docker run -p 8000:8000 causal-platform      # open http://localhost:8000
```

**Local development**

```bash
# backend (Python 3.10-3.13)
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn causal_platform.api:app --reload --port 8000
python -m pytest -q

# frontend (Node 20+), in a second terminal
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api to :8000
```

## API

| Endpoint | Body |
|---|---|
| `GET /api/datasets` | returns demo and uploaded datasets with default column mappings |
| `GET /api/datasets/{id}` | returns columns, dtypes and a preview |
| `POST /api/upload` | multipart `file` (CSV, 20 MB max) |
| `POST /api/did` | `{dataset, unit, time, outcome, treated, post}` |
| `POST /api/synth` | `{dataset, unit, time, outcome, treated_unit, treatment_time, placebos?}` |
| `POST /api/psm` | `{dataset, treatment, outcome, covariates[], target?, refute?}` |

Interactive docs are served at `/docs`.

## Layout

```
backend/causal_platform/
  estimators/did.py     TWFE DiD + event study + pre-trend test
  estimators/synth.py   synthetic control + placebo inference
  estimators/psm.py     DoWhy PSM + balance/overlap diagnostics
  datasets.py           simulated datasets with ground-truth effects
  api.py                FastAPI app (also serves frontend/dist)
backend/tests/          estimator recovery tests + API tests
frontend/src/           React app; charts/charts.tsx holds the D3 charts
```
