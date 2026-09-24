import pytest
from fastapi.testclient import TestClient

from causal_platform.api import app
from causal_platform.datasets import DATASETS, job_training_observational, minimum_wage_panel, tobacco_tax_states
from causal_platform.estimators.did import difference_in_differences
from causal_platform.estimators.psm import propensity_score_matching
from causal_platform.estimators.synth import synthetic_control


def test_did_recovers_effect_and_passes_pretrend():
    r = difference_in_differences(minimum_wage_panel(), "unit", "period", "employment", "treated", "post")
    assert r["ci"][0] < -1.5 < r["ci"][1]
    assert abs(r["estimate"] - r["did_2x2"]) < 1e-8  # balanced panel: TWFE == 2x2
    assert r["pretrend_p_value"] > 0.05
    assert {e["rel_time"] for e in r["event_study"]} == set(range(-7, 5))


def test_did_rejects_missing_columns():
    with pytest.raises(ValueError):
        difference_in_differences(minimum_wage_panel(), "unit", "period", "nope", "treated", "post")


def test_synth_recovers_weights_and_effect():
    r = synthetic_control(tobacco_tax_states(), "state", "year", "cigsale", "California", 1989)
    # donors share 3 latent factors, so weights aren't unique; the true top donor should still lead
    assert r["weights"][0]["unit"] == "State_03"
    assert abs(sum(x["weight"] for x in r["weights"]) - 1) < 0.01
    assert r["pre_rmspe"] < 1.0
    post_gaps = [s["gap"] for s in r["series"] if s["time"] >= 1991]
    assert abs(sum(post_gaps) / len(post_gaps) + 12) < 2.0
    assert r["p_value"] <= 1 / 29 + 1e-9  # treated unit has the most extreme RMSPE ratio


def test_psm_removes_confounding_bias():
    df = job_training_observational()
    r = propensity_score_matching(df, "treat", "re78", ["age", "educ", "married", "re74"], target="att", refute=False)
    assert abs(r["naive_difference"] - 1800) > 1000  # naive estimate is badly biased
    assert abs(r["estimate"] - 1800) < 600
    for b in r["balance"]:
        assert abs(b["smd_after"]) < abs(b["smd_before"]) or abs(b["smd_after"]) < 0.1


client = TestClient(app)


def test_api_demo_endpoints():
    ds = client.get("/api/datasets").json()
    assert {d["id"] for d in ds} >= set(DATASETS)
    for d in ds:
        path = {"did": "/api/did", "synth": "/api/synth", "psm": "/api/psm"}[d["method"]]
        body = {"dataset": d["id"], **d["defaults"]}
        if d["method"] == "psm":
            body["refute"] = False
        res = client.post(path, json=body)
        assert res.status_code == 200, res.text
        assert "estimate" in res.json()


def test_api_upload_and_errors():
    csv = minimum_wage_panel().to_csv(index=False).encode()
    up = client.post("/api/upload", files={"file": ("panel.csv", csv, "text/csv")}).json()
    assert up["n_rows"] == 960
    r = client.post("/api/did", json=dict(dataset=up["id"], unit="unit", time="period", outcome="employment",
                                          treated="treated", post="post"))
    assert r.status_code == 200
    bad = client.post("/api/did", json=dict(dataset=up["id"], unit="unit", time="period", outcome="missing",
                                            treated="treated", post="post"))
    assert bad.status_code == 422
    assert client.get("/api/datasets/does_not_exist").status_code == 404
