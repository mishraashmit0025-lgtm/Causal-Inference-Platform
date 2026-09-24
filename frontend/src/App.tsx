import { useEffect, useMemo, useState } from "react";
import { api, DatasetDetail, DatasetInfo, DiDResult, Method, PSMResult, Result, SynthResult } from "./api";
import { CoefPlot, LineChart, LovePlot, MirrorHistogram, WeightBars } from "./charts/charts";

const METHODS: { id: Method; label: string; blurb: string }[] = [
  { id: "did", label: "Difference-in-differences", blurb: "Two-way fixed effects with unit-clustered SEs and an event study." },
  { id: "synth", label: "Synthetic control", blurb: "Convex donor weights fit on the pre-period, placebo-in-space inference." },
  { id: "psm", label: "Propensity score matching", blurb: "DoWhy backdoor PSM with balance, overlap and placebo refutation." },
];

const FIELDS: Record<Method, { key: string; label: string; kind: "column" | "columns" | "text" | "number" | "target" }[]> = {
  did: [
    { key: "unit", label: "Unit id", kind: "column" },
    { key: "time", label: "Time", kind: "column" },
    { key: "outcome", label: "Outcome", kind: "column" },
    { key: "treated", label: "Treated group (0/1)", kind: "column" },
    { key: "post", label: "Post period (0/1)", kind: "column" },
  ],
  synth: [
    { key: "unit", label: "Unit id", kind: "column" },
    { key: "time", label: "Time", kind: "column" },
    { key: "outcome", label: "Outcome", kind: "column" },
    { key: "treated_unit", label: "Treated unit", kind: "text" },
    { key: "treatment_time", label: "First treated period", kind: "number" },
  ],
  psm: [
    { key: "treatment", label: "Treatment (0/1)", kind: "column" },
    { key: "outcome", label: "Outcome", kind: "column" },
    { key: "covariates", label: "Confounders", kind: "columns" },
    { key: "target", label: "Estimand", kind: "target" },
  ],
};

const fmt = (v: number | null | undefined, d = 3) =>
  v === null || v === undefined ? "-" : Number.isInteger(v) || Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(d);
const fmtP = (p: number | null | undefined) => (p === null || p === undefined ? "-" : p < 0.001 ? "< 0.001" : p.toFixed(3));

export default function App() {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [datasetId, setDatasetId] = useState<string>("");
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [method, setMethod] = useState<Method>("did");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const info = datasets.find((d) => d.id === datasetId);

  useEffect(() => {
    api.datasets().then((ds) => {
      setDatasets(ds);
      if (ds.length) selectDataset(ds[0]);
    }, (e) => setError(String(e.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectDataset(d: DatasetInfo) {
    setDatasetId(d.id);
    setResult(null);
    setError(null);
    if (d.method) setMethod(d.method);
    setParams({ target: "att", ...d.defaults });
    api.dataset(d.id).then(setDetail, (e) => setError(e.message));
  }

  async function onUpload(file: File) {
    setError(null);
    try {
      const up = await api.upload(file);
      const ds = await api.datasets();
      setDatasets(ds);
      setDatasetId(up.id);
      setDetail(up);
      setParams({ target: "att" });
      setResult(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.estimate(method, { dataset: datasetId, ...params }));
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const columns = detail?.columns.map((c) => c.name) ?? [];
  const trueEffect = info && info.method === method ? info.true_effect : null;

  return (
    <div className="layout">
      <header>
        <h1>Causal Inference Platform</h1>
        <p>Estimate treatment effects from panel and observational data, then check the assumptions behind them.</p>
      </header>

      <aside className="panel">
        <label className="field">
          <span>Dataset</span>
          <select value={datasetId} onChange={(e) => selectDataset(datasets.find((d) => d.id === e.target.value)!)}>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>{d.id}</option>
            ))}
          </select>
        </label>
        {info && <p className="hint">{info.description}</p>}
        <label className="upload">
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
          <span>Upload CSV…</span>
        </label>

        <div className="method-tabs" role="tablist">
          {METHODS.map((m) => (
            <button key={m.id} role="tab" aria-selected={method === m.id} className={method === m.id ? "active" : ""}
              onClick={() => { setMethod(m.id); setResult(null); }}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="hint">{METHODS.find((m) => m.id === method)!.blurb}</p>

        {FIELDS[method].map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            {f.kind === "column" && (
              <select value={String(params[f.key] ?? "")} onChange={(e) => setParams({ ...params, [f.key]: e.target.value })}>
                <option value="">choose…</option>
                {columns.map((c) => <option key={c}>{c}</option>)}
              </select>
            )}
            {f.kind === "columns" && (
              <div className="chips">
                {columns.map((c) => {
                  const sel = ((params[f.key] as string[]) ?? []).includes(c);
                  return (
                    <button key={c} type="button" className={sel ? "chip on" : "chip"} onClick={() => {
                      const cur = (params[f.key] as string[]) ?? [];
                      setParams({ ...params, [f.key]: sel ? cur.filter((x) => x !== c) : [...cur, c] });
                    }}>{c}</button>
                  );
                })}
              </div>
            )}
            {f.kind === "text" && (
              <input value={String(params[f.key] ?? "")} onChange={(e) => setParams({ ...params, [f.key]: e.target.value })} />
            )}
            {f.kind === "number" && (
              <input type="number" value={String(params[f.key] ?? "")} onChange={(e) => setParams({ ...params, [f.key]: Number(e.target.value) })} />
            )}
            {f.kind === "target" && (
              <select value={String(params.target ?? "att")} onChange={(e) => setParams({ ...params, target: e.target.value })}>
                <option value="att">ATT (effect on the treated)</option>
                <option value="ate">ATE (average effect)</option>
                <option value="atc">ATC (effect on controls)</option>
              </select>
            )}
          </label>
        ))}
        <button className="run" disabled={busy || !datasetId} onClick={run}>{busy ? "Estimating…" : "Estimate effect"}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </aside>

      <main>
        {!result && detail && <Preview detail={detail} />}
        {result?.method === "difference_in_differences" && <DiDView r={result} trueEffect={trueEffect} />}
        {result?.method === "synthetic_control" && <SynthView r={result} trueEffect={trueEffect} />}
        {result?.method === "propensity_score_matching" && <PSMView r={result} trueEffect={trueEffect} />}
      </main>
    </div>
  );
}

function Stats({ items }: { items: [string, string, string?][] }) {
  return (
    <div className="stats">
      {items.map(([k, v, sub]) => (
        <div key={k} className="stat">
          <div className="k">{k}</div>
          <div className="v">{v}</div>
          {sub && <div className="sub">{sub}</div>}
        </div>
      ))}
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {note && <p className="hint">{note}</p>}
      <div className="chart">{children}</div>
    </section>
  );
}

function Preview({ detail }: { detail: DatasetDetail }) {
  const cols = detail.columns.map((c) => c.name);
  return (
    <section className="card">
      <h2>Data preview · {detail.n_rows.toLocaleString()} rows</h2>
      <div className="table-wrap">
        <table>
          <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {detail.preview.map((row, i) => (
              <tr key={i}>{cols.map((c) => <td key={c}>{typeof row[c] === "number" ? fmt(row[c] as number) : String(row[c])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Pick a method and columns on the left, then click <b>Estimate effect</b>.</p>
    </section>
  );
}

function DiDView({ r, trueEffect }: { r: DiDResult; trueEffect: number | null }) {
  const series = useMemo(() => [
    { name: "treated", color: "var(--c-treated)", points: r.trends.map((t) => ({ x: t.time, y: t.treated })) },
    { name: "control", color: "var(--c-control)", points: r.trends.map((t) => ({ x: t.time, y: t.control })) },
  ], [r]);
  return (
    <>
      <Stats items={[
        ["DiD estimate", fmt(r.estimate), `95% CI [${fmt(r.ci[0])}, ${fmt(r.ci[1])}]`],
        ["p-value", fmtP(r.p_value), `SE ${fmt(r.std_error)} (clustered)`],
        ["Pre-trend test", fmtP(r.pretrend_p_value), r.pretrend_p_value !== null && r.pretrend_p_value < 0.05 ? "parallel trends rejected" : "no evidence against parallel trends"],
        ...(trueEffect !== null ? [["True effect (simulated)", fmt(trueEffect)] as [string, string]] : []),
      ]} />
      <Card title="Group means over time" note="Outcome averages for treated and control groups; the dashed line marks the first treated period.">
        <LineChart series={series} marker={r.treatment_start} xLabel="time" yLabel="mean outcome" />
      </Card>
      <Card title="Event study" note="Leads should hover around zero if trends were parallel; lags trace the dynamic effect. Reference period: t = -1.">
        <CoefPlot points={r.event_study} xLabel="periods relative to treatment" />
      </Card>
    </>
  );
}

function SynthView({ r, trueEffect }: { r: SynthResult; trueEffect: number | null }) {
  const levels = useMemo(() => [
    { name: "treated", color: "var(--c-treated)", points: r.series.map((s) => ({ x: s.time, y: s.treated })) },
    { name: "synthetic", color: "var(--c-synth)", dashed: true, points: r.series.map((s) => ({ x: s.time, y: s.synthetic })) },
  ], [r]);
  const gaps = useMemo(() => [
    ...r.placebos.map((p) => ({ name: p.unit, color: "var(--muted)", faint: true, points: p.gap.map((g, i) => ({ x: r.series[i].time, y: g })) })),
    { name: "treated gap", color: "var(--c-treated)", points: r.series.map((s) => ({ x: s.time, y: s.gap })) },
  ], [r]);
  return (
    <>
      <Stats items={[
        ["Average post-period gap", fmt(r.estimate)],
        ["Placebo p-value", fmtP(r.p_value), `RMSPE ratio ${fmt(r.rmspe_ratio, 1)}`],
        ["Pre-period RMSPE", fmt(r.pre_rmspe), "fit quality"],
        ...(trueEffect !== null ? [["True effect (simulated)", fmt(trueEffect)] as [string, string]] : []),
      ]} />
      <Card title="Treated vs synthetic" note="The synthetic unit is a weighted average of donors that tracks the treated unit before treatment.">
        <LineChart series={levels} marker={r.treatment_time} xLabel="time" yLabel="outcome" />
      </Card>
      <Card title="Gap vs placebo gaps" note="Grey lines rerun the method with each donor as the placebo treated unit (poorly fitting placebos are dropped).">
        <LineChart series={gaps} marker={r.treatment_time} xLabel="time" yLabel="treated minus synthetic" zeroLine />
      </Card>
      <Card title="Donor weights"><WeightBars weights={r.weights} /></Card>
    </>
  );
}

function PSMView({ r, trueEffect }: { r: PSMResult; trueEffect: number | null }) {
  return (
    <>
      <Stats items={[
        [`Matched ${r.target.toUpperCase()}`, fmt(r.estimate), `${r.n_treated} treated · ${r.n_control} control`],
        ["Naive difference", fmt(r.naive_difference), "unadjusted, biased by confounding"],
        ["Placebo refutation", r.refutation ? fmt(r.refutation.placebo_effect) : "-", r.refutation ? `p = ${fmtP(r.refutation.p_value)} (should be ~0 effect)` : "skipped"],
        ...(trueEffect !== null ? [["True effect (simulated)", fmt(trueEffect)] as [string, string]] : []),
      ]} />
      <Card title="Propensity score overlap" note={`Common support: [${r.common_support[0].toFixed(3)}, ${r.common_support[1].toFixed(3)}]`}>
        <MirrorHistogram bins={r.propensity_hist} />
      </Card>
      <Card title="Covariate balance (love plot)" note="Standardized mean differences before (grey-blue) and after (orange) matching; |SMD| < 0.1 is the usual target.">
        <LovePlot rows={r.balance} />
      </Card>
    </>
  );
}
