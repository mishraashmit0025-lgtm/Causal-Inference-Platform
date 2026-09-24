export type Method = "did" | "synth" | "psm";

export interface DatasetInfo {
  id: string;
  method: Method | null;
  description: string;
  true_effect: number | null;
  defaults: Record<string, unknown>;
}

export interface ColumnInfo {
  name: string;
  dtype: string;
  n_unique: number;
}

export interface DatasetDetail {
  n_rows: number;
  columns: ColumnInfo[];
  preview: Record<string, unknown>[];
}

export interface DiDResult {
  method: "difference_in_differences";
  estimate: number;
  std_error: number;
  ci: [number, number];
  p_value: number;
  did_2x2: number;
  pretrend_p_value: number | null;
  n_obs: number;
  n_units: number;
  treatment_start: number;
  trends: { time: number; treated: number; control: number }[];
  event_study: { rel_time: number; coef: number; lo: number; hi: number }[];
}

export interface SynthResult {
  method: "synthetic_control";
  estimate: number;
  pre_rmspe: number;
  post_rmspe: number;
  rmspe_ratio: number;
  p_value: number | null;
  treatment_time: number;
  weights: { unit: string; weight: number }[];
  series: { time: number; treated: number; synthetic: number; gap: number }[];
  placebos: { unit: string; gap: number[] }[];
}

export interface PSMResult {
  method: "propensity_score_matching";
  target: string;
  estimate: number;
  naive_difference: number;
  n_treated: number;
  n_control: number;
  balance: { covariate: string; smd_before: number; smd_after: number }[];
  propensity_hist: { bin_start: number; bin_end: number; treated: number; control: number }[];
  common_support: [number, number];
  refutation: { placebo_effect: number; p_value: number | null } | null;
}

export type Result = DiDResult | SynthResult | PSMResult;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep status text */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  datasets: () => fetch("/api/datasets").then((r) => json<DatasetInfo[]>(r)),
  dataset: (id: string) => fetch(`/api/datasets/${encodeURIComponent(id)}`).then((r) => json<DatasetDetail>(r)),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch("/api/upload", { method: "POST", body: fd }).then((r) => json<DatasetDetail & { id: string }>(r));
  },
  estimate: (method: Method, body: Record<string, unknown>) =>
    fetch(`/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<Result>(r)),
};
