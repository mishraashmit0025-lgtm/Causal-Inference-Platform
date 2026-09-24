import * as d3 from "d3";
import { useEffect, useRef } from "react";

const M = { top: 16, right: 20, bottom: 40, left: 56 };
const H = 300;

function useSvg(draw: (svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, w: number) => void, deps: unknown[]) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const render = () => {
      const w = el.parentElement?.clientWidth ?? 600;
      const svg = d3.select(el).attr("width", w).attr("height", H);
      svg.selectAll("*").remove();
      draw(svg, w);
    };
    render();
    const ro = new ResizeObserver(render);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function axes(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  x: d3.AxisScale<d3.NumberValue> | d3.ScaleBand<string>,
  y: d3.ScaleLinear<number, number>,
  iw: number,
  ih: number,
  xLabel: string,
  yLabel: string,
  yFormat: (v: d3.NumberValue) => string = d3.format("~g"),
) {
  const xa = g.append("g").attr("transform", `translate(0,${ih})`);
  if ("bandwidth" in x) xa.call(d3.axisBottom(x as d3.ScaleBand<string>));
  else xa.call(d3.axisBottom(x as d3.ScaleLinear<number, number>).ticks(8).tickFormat(d3.format("~g")));
  g.append("g").call(d3.axisLeft(y).ticks(6).tickFormat(yFormat));
  g.append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(y).ticks(6).tickSize(-iw).tickFormat(() => ""))
    .call((s) => s.select(".domain").remove());
  g.append("text").attr("class", "axis-label").attr("x", iw / 2).attr("y", ih + 34).attr("text-anchor", "middle").text(xLabel);
  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -ih / 2)
    .attr("y", -42)
    .attr("text-anchor", "middle")
    .text(yLabel);
}

export interface Series {
  name: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
  faint?: boolean;
}

export function LineChart({
  series,
  marker,
  xLabel,
  yLabel,
  zeroLine,
}: {
  series: Series[];
  marker?: number;
  xLabel: string;
  yLabel: string;
  zeroLine?: boolean;
}) {
  const ref = useSvg(
    (svg, w) => {
      const iw = w - M.left - M.right,
        ih = H - M.top - M.bottom;
      const all = series.flatMap((s) => s.points);
      const x = d3.scaleLinear().domain(d3.extent(all, (p) => p.x) as [number, number]).range([0, iw]);
      const ext = d3.extent(all, (p) => p.y) as [number, number];
      const pad = (ext[1] - ext[0]) * 0.08 || 1;
      const y = d3.scaleLinear().domain([Math.min(ext[0] - pad, zeroLine ? 0 : Infinity), Math.max(ext[1] + pad, zeroLine ? 0 : -Infinity)]).range([ih, 0]);
      const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);
      axes(g, x, y, iw, ih, xLabel, yLabel);
      if (zeroLine) g.append("line").attr("class", "ref-line").attr("x1", 0).attr("x2", iw).attr("y1", y(0)).attr("y2", y(0));
      if (marker !== undefined) {
        g.append("line").attr("class", "marker-line").attr("x1", x(marker)).attr("x2", x(marker)).attr("y1", 0).attr("y2", ih);
        g.append("text").attr("class", "marker-label").attr("x", x(marker) + 4).attr("y", 12).text("treatment");
      }
      const line = d3
        .line<{ x: number; y: number }>()
        .x((p) => x(p.x))
        .y((p) => y(p.y));
      for (const s of series) {
        g.append("path")
          .datum(s.points)
          .attr("fill", "none")
          .attr("stroke", s.color)
          .attr("stroke-width", s.faint ? 1 : 2.25)
          .attr("stroke-opacity", s.faint ? 0.35 : 1)
          .attr("stroke-dasharray", s.dashed ? "6 4" : null)
          .attr("d", line);
        if (!s.faint)
          g.selectAll(null)
            .data(s.points)
            .join("circle")
            .attr("cx", (p) => x(p.x))
            .attr("cy", (p) => y(p.y))
            .attr("r", 3)
            .attr("fill", s.color)
            .append("title")
            .text((p) => `${s.name}\n${xLabel}: ${p.x}\n${d3.format(".3~f")(p.y)}`);
      }
    },
    [series, marker, xLabel, yLabel, zeroLine],
  );
  const named = series.filter((s) => !s.faint);
  return (
    <>
      <div className="legend">
        {named.map((s) => (
          <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>
        ))}
        {series.some((s) => s.faint) && <span><i style={{ background: "var(--muted)" }} />placebos</span>}
      </div>
      <svg ref={ref} role="img" aria-label={`${yLabel} by ${xLabel}`} />
    </>
  );
}

export function CoefPlot({ points, xLabel }: { points: { rel_time: number; coef: number; lo: number; hi: number }[]; xLabel: string }) {
  const ref = useSvg(
    (svg, w) => {
      const iw = w - M.left - M.right,
        ih = H - M.top - M.bottom;
      const x = d3.scaleLinear().domain(d3.extent(points, (p) => p.rel_time) as [number, number]).nice().range([0, iw]);
      const lo = d3.min(points, (p) => p.lo)!,
        hi = d3.max(points, (p) => p.hi)!;
      const y = d3.scaleLinear().domain([Math.min(lo, 0), Math.max(hi, 0)]).nice().range([ih, 0]);
      const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);
      axes(g, x, y, iw, ih, xLabel, "coefficient (95% CI)");
      g.append("line").attr("class", "ref-line").attr("x1", 0).attr("x2", iw).attr("y1", y(0)).attr("y2", y(0));
      g.append("line").attr("class", "marker-line").attr("x1", x(-0.5)).attr("x2", x(-0.5)).attr("y1", 0).attr("y2", ih);
      const pt = g.selectAll(null).data(points).join("g");
      pt.append("line")
        .attr("x1", (p) => x(p.rel_time))
        .attr("x2", (p) => x(p.rel_time))
        .attr("y1", (p) => y(p.lo))
        .attr("y2", (p) => y(p.hi))
        .attr("stroke", (p) => (p.rel_time < 0 ? "var(--c-control)" : "var(--c-treated)"))
        .attr("stroke-width", 2);
      pt.append("circle")
        .attr("cx", (p) => x(p.rel_time))
        .attr("cy", (p) => y(p.coef))
        .attr("r", 4.5)
        .attr("fill", (p) => (p.rel_time < 0 ? "var(--c-control)" : "var(--c-treated)"))
        .append("title")
        .text((p) => `t = ${p.rel_time}\ncoef ${p.coef.toFixed(3)} [${p.lo.toFixed(3)}, ${p.hi.toFixed(3)}]`);
    },
    [points, xLabel],
  );
  return <svg ref={ref} role="img" />;
}

export function MirrorHistogram({ bins }: { bins: { bin_start: number; bin_end: number; treated: number; control: number }[] }) {
  const ref = useSvg(
    (svg, w) => {
      const iw = w - M.left - M.right,
        ih = H - M.top - M.bottom;
      const x = d3.scaleLinear().domain([0, 1]).range([0, iw]);
      const mx = d3.max(bins, (b) => Math.max(b.treated, b.control))!;
      const y = d3.scaleLinear().domain([-mx, mx]).nice().range([ih, 0]);
      const g = svg.append("g").attr("transform", `translate(${M.left},${M.top})`);
      axes(g, x, y, iw, ih, "propensity score", "count (treated above / control below)", (v) => d3.format("~g")(Math.abs(+v)));
      const bar = (key: "treated" | "control", color: string, up: boolean) =>
        g
          .selectAll(null)
          .data(bins)
          .join("rect")
          .attr("x", (b) => x(b.bin_start) + 1)
          .attr("width", (b) => Math.max(0, x(b.bin_end) - x(b.bin_start) - 2))
          .attr("y", (b) => (up ? y(b[key]) : y(0)))
          .attr("height", (b) => Math.abs(y(0) - y(b[key])))
          .attr("fill", color)
          .attr("rx", 2)
          .append("title")
          .text((b) => `${key}: ${b[key]} in [${b.bin_start.toFixed(2)}, ${b.bin_end.toFixed(2)})`);
      bar("treated", "var(--c-treated)", true);
      bar("control", "var(--c-control)", false);
      g.append("line").attr("class", "ref-line").attr("x1", 0).attr("x2", iw).attr("y1", y(0)).attr("y2", y(0));
    },
    [bins],
  );
  return <svg ref={ref} role="img" />;
}

export function LovePlot({ rows }: { rows: { covariate: string; smd_before: number; smd_after: number }[] }) {
  const ref = useSvg(
    (svg, w) => {
      const iw = w - M.left - M.right - 40,
        ih = H - M.top - M.bottom;
      const mx = Math.max(0.25, d3.max(rows, (r) => Math.max(Math.abs(r.smd_before), Math.abs(r.smd_after)))! * 1.1);
      const x = d3.scaleLinear().domain([0, mx]).range([0, iw]);
      const y = d3.scaleBand().domain(rows.map((r) => r.covariate)).range([0, ih]).padding(0.5);
      const g = svg.append("g").attr("transform", `translate(${M.left + 40},${M.top})`);
      g.append("g").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(6));
      g.append("g").call(d3.axisLeft(y));
      g.append("text").attr("class", "axis-label").attr("x", iw / 2).attr("y", ih + 34).attr("text-anchor", "middle").text("|standardized mean difference|");
      g.append("line").attr("class", "marker-line").attr("x1", x(0.1)).attr("x2", x(0.1)).attr("y1", 0).attr("y2", ih);
      const row = g.selectAll(null).data(rows).join("g").attr("transform", (r) => `translate(0,${y(r.covariate)! + y.bandwidth() / 2})`);
      row.append("line").attr("x1", (r) => x(Math.abs(r.smd_before))).attr("x2", (r) => x(Math.abs(r.smd_after))).attr("stroke", "var(--muted)");
      row.append("circle").attr("cx", (r) => x(Math.abs(r.smd_before))).attr("r", 6).attr("fill", "var(--c-control)")
        .append("title").text((r) => `before: ${r.smd_before.toFixed(3)}`);
      row.append("circle").attr("cx", (r) => x(Math.abs(r.smd_after))).attr("r", 6).attr("fill", "var(--c-treated)")
        .append("title").text((r) => `after: ${r.smd_after.toFixed(3)}`);
    },
    [rows],
  );
  return <svg ref={ref} role="img" />;
}

export function WeightBars({ weights }: { weights: { unit: string; weight: number }[] }) {
  const ref = useSvg(
    (svg, w) => {
      const top = weights.slice(0, 10);
      const iw = w - M.left - M.right - 50,
        ih = H - M.top - M.bottom;
      const x = d3.scaleLinear().domain([0, d3.max(top, (d) => d.weight)!]).nice().range([0, iw]);
      const y = d3.scaleBand().domain(top.map((d) => d.unit)).range([0, ih]).padding(0.25);
      const g = svg.append("g").attr("transform", `translate(${M.left + 50},${M.top})`);
      g.append("g").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));
      g.append("g").call(d3.axisLeft(y));
      g.append("text").attr("class", "axis-label").attr("x", iw / 2).attr("y", ih + 34).attr("text-anchor", "middle").text("donor weight");
      g.selectAll(null)
        .data(top)
        .join("rect")
        .attr("y", (d) => y(d.unit)!)
        .attr("height", y.bandwidth())
        .attr("width", (d) => x(d.weight))
        .attr("fill", "var(--c-synth)")
        .attr("rx", 3)
        .append("title")
        .text((d) => `${d.unit}: ${(d.weight * 100).toFixed(1)}%`);
    },
    [weights],
  );
  return <svg ref={ref} role="img" />;
}
