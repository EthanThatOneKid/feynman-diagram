#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * Feynman diagram renderer: turns a semantic spec (JSON) into an SVG.
 *
 * The spec says *what happens* (who decides each stretch of time, what each
 * event does to the world, where control branches, merges, and stops). This
 * script owns *where it goes*: lanes, spacing, curves, wave lines, labels,
 * legend, and theme. See ../references/spec.md for the format.
 *
 * Usage:
 *   deno run --allow-read --allow-write render.ts <spec.json> [-o out.svg] [--png out.png]
 */

// ---------- spec types ----------

export type LineKind = "code" | "model" | "human" | "wait";
export type Decider = "code" | "model" | "human";
export type VertexKind = "read" | "reversible" | "irreversible" | "trust" | "stop" | "branch" | "junction" | "gate";
type Text = string | string[];

export interface LineStep {
  line: LineKind;
  label?: string;
  note?: Text;
  len?: number;
  probe?: Probe;
}

export interface VertexStep {
  vertex: VertexKind;
  id?: string;
  label?: string;
  note?: Text;
  by?: Decider;
  labelPos?: "above" | "below" | "right" | "above-left";
}

export interface Probe {
  vertex?: VertexKind;
  line?: LineKind;
  label?: string;
  note?: Text;
  height?: number;
  side?: "above" | "below";
  /** Where along the line the probe leaves, 0..1 (default 0.62, clear of a centered label). */
  at?: number;
}

export type Step = LineStep | VertexStep;

export interface Track {
  id?: string;
  lane: number;
  line?: LineKind;
  from?: string;
  merge?: string;
  start?: { label: string; note?: Text };
  label?: string;
  note?: Text;
  shape?: "curve" | "square";
  arrow?: boolean;
  steps?: Step[];
}

export interface Spec {
  title?: string;
  legend?: false | Partial<Record<LineKind | VertexKind, string>>;
  time?: false | string;
  lanePx?: number;
  tracks: Track[];
}

// ---------- constants ----------

const LINE_KINDS: LineKind[] = ["code", "model", "human", "wait"];
const VERTEX_KINDS: VertexKind[] = [
  "read",
  "reversible",
  "irreversible",
  "trust",
  "stop",
  "branch",
  "junction",
  "gate",
];
const DECIDERS: Decider[] = ["code", "model", "human"];

const DEFAULT_LEGEND: Record<LineKind | VertexKind, string> = {
  code: "code decides",
  model: "the model decides",
  human: "a human decides",
  wait: "asleep, waiting",
  read: "reads the world",
  reversible: "changes the world, can be undone",
  irreversible: "changes the world, cannot be undone",
  trust: "temporary trust",
  gate: "asks a human",
  stop: "stops",
  branch: "branches",
  junction: "joins",
};
const LEGEND_ORDER: (LineKind | VertexKind)[] = [
  "code",
  "model",
  "human",
  "wait",
  "read",
  "reversible",
  "irreversible",
  "gate",
  "trust",
  "stop",
];

const DEFAULT_LEN: Record<LineKind, number> = { code: 90, model: 220, human: 120, wait: 200 };
const IMPLICIT_LEN = 56;
const MARGIN = 40;
const LABEL = 15;
const NOTE = 13;
const NOTE_LEAD = 17;
const WAVE_AMP = 6;
const WAVE_LEN = 22;

// ---------- small helpers ----------

type Pt = [number, number];

const lines = (t?: Text): string[] => (t === undefined ? [] : Array.isArray(t) ? t : [t]);
const textW = (s: string, size: number, bold = false) => s.length * size * (bold ? 0.6 : 0.54);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isLine = (s: Step): s is LineStep => "line" in s;
const r1 = (n: number) => Math.round(n * 10) / 10;

function bezier(a: Pt, b: Pt, n = 48): Pt[] {
  const mx = (a[0] + b[0]) / 2;
  const c1: Pt = [mx, a[1]];
  const c2: Pt = [mx, b[1]];
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
      u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1],
    ]);
  }
  return out;
}

/** Offset a polyline by a sine wave along its normal (the "model decides" squiggle). */
function wave(pts: Pt[]): Pt[] {
  const dense: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / 1.5));
    for (let k = 1; k <= n; k++) dense.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
  }
  const out: Pt[] = [];
  let s = 0;
  for (let i = 0; i < dense.length; i++) {
    if (i > 0) s += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    const off = WAVE_AMP * Math.sin((2 * Math.PI * s) / WAVE_LEN);
    out.push([dense[i][0] + nx * off, dense[i][1] + ny * off]);
  }
  return out;
}

// ---------- validation ----------

export function validate(spec: Spec): string[] {
  const errs: string[] = [];
  if (!spec || !Array.isArray(spec.tracks) || spec.tracks.length === 0) {
    return ["spec.tracks must be a non-empty array"];
  }
  const ids = new Set<string>();
  spec.tracks.forEach((t, i) => {
    const at = `tracks[${i}]${t.id ? ` (${t.id})` : ""}`;
    if (typeof t.lane !== "number") errs.push(`${at}: lane must be a number`);
    if (t.line && !LINE_KINDS.includes(t.line)) errs.push(`${at}: unknown line kind "${t.line}"`);
    if (!t.from && !t.start) errs.push(`${at}: needs "start" (a trigger) or "from" (a vertex id it branches from)`);
    (t.steps ?? []).forEach((s, j) => {
      const sat = `${at}.steps[${j}]`;
      if (isLine(s)) {
        if (!LINE_KINDS.includes(s.line)) errs.push(`${sat}: unknown line kind "${s.line}"`);
        if (s.probe?.vertex && !VERTEX_KINDS.includes(s.probe.vertex)) errs.push(`${sat}.probe: unknown vertex kind`);
        if (s.probe?.line && !LINE_KINDS.includes(s.probe.line)) errs.push(`${sat}.probe: unknown line kind`);
      } else if ("vertex" in s) {
        if (!VERTEX_KINDS.includes(s.vertex)) errs.push(`${sat}: unknown vertex kind "${s.vertex}"`);
        if (s.by && !DECIDERS.includes(s.by)) errs.push(`${sat}: "by" must be code, model, or human`);
        if (s.id) {
          if (ids.has(s.id)) errs.push(`${sat}: duplicate vertex id "${s.id}"`);
          ids.add(s.id);
        }
      } else errs.push(`${sat}: a step needs "line" or "vertex"`);
    });
  });
  spec.tracks.forEach((t, i) => {
    for (const key of ["from", "merge"] as const) {
      const ref = t[key];
      if (ref && !ids.has(ref)) errs.push(`tracks[${i}].${key}: no vertex has id "${ref}"`);
    }
  });
  return errs;
}

// ---------- layout ----------

interface Stroke {
  kind: LineKind;
  pts: Pt[];
}
interface Glyph {
  kind: VertexKind;
  x: number;
  y: number;
  by?: Decider;
}
interface Label {
  x: number;
  y: number;
  text: string;
  cls: string;
  size: number;
  anchor: "start" | "middle" | "end";
  bold?: boolean;
}
interface Arrow {
  x: number;
  y: number;
  dir: 1 | -1;
  kind: LineKind;
}

interface Layout {
  strokes: Stroke[];
  glyphs: Glyph[];
  labels: Label[];
  arrows: Arrow[];
  warnings: string[];
}

const lineCls = (k: LineKind | Decider) => (k === "wait" ? "t-note" : `t-${k}`);

function vertexLabelCls(v: VertexStep): string {
  if (v.vertex === "irreversible") return "t-danger";
  if (v.vertex === "trust" || v.vertex === "gate") return "t-human";
  return "t-code";
}

function curveLen(dy: number) {
  return Math.min(150, 46 + Math.abs(dy) * 0.42);
}

function labelPosOf(v: VertexStep) {
  return v.labelPos ?? (v.vertex === "stop" ? "right" : v.vertex === "gate" ? "above-left" : "below");
}

/** Half the width of a vertex's below-the-line text, which a line's own note must stay clear of. */
function belowHalf(v: Step | undefined): number {
  if (!v || isLine(v) || labelPosOf(v) !== "below") return 0;
  const ws = [...(v.label ? [textW(v.label, LABEL, true)] : []), ...lines(v.note).map((n) => textW(n, NOTE))];
  return ws.length ? Math.max(...ws) / 2 + 8 : 0;
}

function insets(steps: Step[], i: number): [number, number] {
  const s = steps[i] as LineStep;
  if (!lines(s.note).length) return [0, 0];
  return [belowHalf(steps[i - 1]), belowHalf(steps[i + 1])];
}

/** Width of the next vertex's above-left label, which hangs back over this line. */
function aboveLeftW(v: Step | undefined): number {
  if (!v || isLine(v) || labelPosOf(v) !== "above-left") return 0;
  const ws = [...(v.label ? [textW(v.label, LABEL, true)] : []), ...lines(v.note).map((n) => textW(n, NOTE))];
  return ws.length ? Math.max(...ws) + 14 : 0;
}

function naturalLen(steps: Step[], i: number) {
  const s = steps[i] as LineStep;
  const base = s.len ?? DEFAULT_LEN[s.line];
  if (s.len !== undefined) return base;
  const [a, b] = insets(steps, i);
  const textNeed = Math.max(
    s.label ? textW(s.label, LABEL, true) + 28 + aboveLeftW(steps[i + 1]) : 0,
    ...lines(s.note).map((n) => textW(n, NOTE) + 24 + a + b),
  );
  return Math.max(base, textNeed);
}

function normalize(t: Track): Step[] {
  const implicit = (): LineStep => ({ line: t.line ?? "code", len: IMPLICIT_LEN });
  const out: Step[] = [];
  for (const s of t.steps ?? []) {
    const prev = out[out.length - 1];
    if (!isLine(s) && (!prev || !isLine(prev))) out.push(implicit());
    out.push(s);
  }
  const last = out[out.length - 1];
  if (t.merge && last && !isLine(last)) out.push(implicit());
  return out;
}

export function layout(spec: Spec): Layout {
  const lanePx = spec.lanePx ?? 115;
  const L: Layout = { strokes: [], glyphs: [], labels: [], arrows: [], warnings: [] };
  const pos = new Map<string, { x: number; y: number; by?: Decider }>();
  const done = new Set<number>();

  const place = (t: Track) => {
    const y = t.lane * lanePx;
    const steps = normalize(t);
    const lineSteps = steps.filter(isLine);
    const kindIn = lineSteps[0]?.line ?? t.line ?? "code";
    const kindOut = lineSteps[lineSteps.length - 1]?.line ?? t.line ?? "code";
    const square = t.shape === "square";
    const parent = t.from ? pos.get(t.from)! : undefined;
    let labelColor: string = lineCls(t.line ?? kindIn);
    if (parent?.by) labelColor = lineCls(parent.by);

    let runStart: number;
    if (parent) {
      if (square && parent.y !== y) {
        L.strokes.push({ kind: t.line ?? kindIn, pts: [[parent.x, parent.y], [parent.x, y]] });
        runStart = parent.x;
      } else if (parent.y !== y) {
        const c = curveLen(y - parent.y);
        L.strokes.push({ kind: kindIn, pts: bezier([parent.x, parent.y], [parent.x + c, y]) });
        runStart = parent.x + c;
      } else runStart = parent.x;
    } else {
      runStart = MARGIN;
      // trigger label: above-main lanes put everything above, below-main lanes below
      const s = t.start!;
      const notes = lines(s.note);
      const cls = lineCls(t.line ?? kindIn);
      if (t.lane < 0) {
        let yy = y - 14 - notes.length * NOTE_LEAD;
        L.labels.push({
          x: runStart - 4,
          y: yy,
          text: s.label,
          cls: cls === "t-code" ? "t-ink" : cls,
          size: LABEL,
          anchor: "start",
          bold: true,
        });
        notes.forEach((n) =>
          L.labels.push({ x: runStart - 4, y: yy += NOTE_LEAD, text: n, cls: "t-note", size: NOTE, anchor: "start" })
        );
      } else if (t.lane > 0) {
        let yy = y + 26;
        L.labels.push({
          x: runStart - 4,
          y: yy,
          text: s.label,
          cls: cls === "t-code" ? "t-ink" : cls,
          size: LABEL,
          anchor: "start",
          bold: true,
        });
        notes.forEach((n) =>
          L.labels.push({ x: runStart - 4, y: yy += NOTE_LEAD, text: n, cls: "t-note", size: NOTE, anchor: "start" })
        );
      } else {
        L.labels.push({
          x: runStart - 4,
          y: y - 14,
          text: s.label,
          cls: cls === "t-code" ? "t-ink" : cls,
          size: LABEL,
          anchor: "start",
          bold: true,
        });
        notes.forEach((n, i) =>
          L.labels.push({
            x: runStart - 4,
            y: y + 26 + i * NOTE_LEAD,
            text: n,
            cls: "t-note",
            size: NOTE,
            anchor: "start",
          })
        );
      }
    }

    const widths = steps.map((s, i) => (isLine(s) ? naturalLen(steps, i) : 0));
    const target = t.merge ? pos.get(t.merge)! : undefined;
    let runEnd = runStart + widths.reduce((a, b) => a + b, 0);
    let cOut = 0;
    if (target) {
      cOut = square || target.y === y ? 0 : curveLen(target.y - y);
      runEnd = target.x - cOut;
      // a trigger with nothing on it is one sweeping curve into its target
      if (steps.length === 0 && !parent && !square) {
        L.strokes.push({ kind: t.line ?? "code", pts: bezier([runStart, y], [target.x, target.y]) });
        return;
      }
      const nat = widths.reduce((a, b) => a + b, 0);
      const avail = runEnd - runStart;
      if (avail < nat - 1) {
        L.warnings.push(
          `track ${t.id ?? `lane ${t.lane}`}: needs ${Math.ceil(nat)}px before merging into "${t.merge}" but has ${
            Math.floor(avail)
          }px; ` +
            `lengthen the line before "${t.merge}" (len) or shorten this track`,
        );
      }
      if (nat > 0) widths.forEach((w, i) => (widths[i] = (w * avail) / nat));
      else if (avail > 0) L.strokes.push({ kind: t.line ?? "code", pts: [[runStart, y], [runEnd, y]] });
    }

    // track label (+ note) centered over the first stretch
    if (t.label) {
      const i0 = steps.findIndex(isLine);
      let x0 = runStart, x1 = runEnd;
      if (i0 >= 0) {
        x0 = runStart + widths.slice(0, i0).reduce((a, b) => a + b, 0);
        x1 = x0 + widths[i0];
      }
      const notes = lines(t.note);
      let yy = y - 14 - notes.length * NOTE_LEAD;
      L.labels.push({
        x: (x0 + x1) / 2,
        y: yy,
        text: t.label,
        cls: labelColor,
        size: LABEL,
        anchor: "middle",
        bold: true,
      });
      notes.forEach((n) =>
        L.labels.push({ x: (x0 + x1) / 2, y: yy += NOTE_LEAD, text: n, cls: "t-note", size: NOTE, anchor: "middle" })
      );
    }

    let cx = runStart;
    let lastBranch: Decider | undefined = parent?.by;
    steps.forEach((s, i) => {
      const w = widths[i];
      if (isLine(s)) {
        L.strokes.push({ kind: s.line, pts: [[cx, y], [cx + w, y]] });
        const mid = cx + (w - (s.label ? aboveLeftW(steps[i + 1]) : 0)) / 2;
        if (s.label) {
          const cls = lastBranch ? lineCls(lastBranch) : s.line === "code" ? "t-ink" : lineCls(s.line);
          L.labels.push({
            x: mid,
            y: y - 16,
            text: s.label,
            cls,
            size: LABEL,
            anchor: "middle",
            bold: s.line !== "code" || !!lastBranch,
          });
        }
        const [ia, ib] = insets(steps, i);
        const noteX = cx + ia + (w - ia - ib) / 2;
        lines(s.note).forEach((n, k) =>
          L.labels.push({ x: noteX, y: y + 30 + k * NOTE_LEAD, text: n, cls: "t-note", size: NOTE, anchor: "middle" })
        );
        if (s.probe) {
          const p = s.probe;
          // default: right of center, clear of a centered stretch label
          const clear = s.label ? (textW(s.label, LABEL, true) / 2 + 16) / w : 0;
          const mid = cx + w * (p.at ?? Math.min(0.85, Math.max(0.62, 0.5 + clear)));
          const h = (p.height ?? 70) * (p.side === "below" ? 1 : -1);
          L.strokes.push({ kind: p.line ?? s.line, pts: [[mid, y], [mid, y + h]] });
          L.glyphs.push({ kind: p.vertex ?? "read", x: mid, y: y + h });
          const pl = [...(p.label ? [p.label] : []), ...lines(p.note)];
          pl.forEach((n, k) =>
            L.labels.push({
              x: mid + 16,
              y: y + h - 4 + k * NOTE_LEAD,
              text: n,
              cls: "t-note",
              size: NOTE,
              anchor: "start",
            })
          );
        }
        lastBranch = undefined;
        cx += w;
      } else {
        L.glyphs.push({ kind: s.vertex, x: cx, y, by: s.by });
        if (s.id) pos.set(s.id, { x: cx, y, by: s.by });
        if (s.vertex === "branch") lastBranch = s.by ?? "code";
        const where = labelPosOf(s);
        const notes = lines(s.note);
        const cls = vertexLabelCls(s);
        const bold = s.vertex === "irreversible" || s.vertex === "gate";
        if (where === "right") {
          const all = [...(s.label ? [{ t: s.label, c: cls }] : []), ...notes.map((n) => ({ t: n, c: "t-note" }))];
          all.forEach((a, k) =>
            L.labels.push({
              x: cx + 14,
              y: y + 5 + k * NOTE_LEAD,
              text: a.t,
              cls: a.c,
              size: a.c === "t-note" ? NOTE : LABEL,
              anchor: "start",
            })
          );
        } else if (where === "above" || where === "above-left") {
          const left = where === "above-left";
          const ax = left ? cx - 6 : cx;
          const anchor = left ? "end" : "middle";
          let yy = y - (left ? 26 : 18) - notes.length * NOTE_LEAD;
          if (s.label) L.labels.push({ x: ax, y: yy, text: s.label, cls, size: LABEL, anchor, bold });
          notes.forEach((n) =>
            L.labels.push({ x: ax, y: yy += NOTE_LEAD, text: n, cls: "t-note", size: NOTE, anchor })
          );
        } else {
          let yy = y + 32;
          if (s.label) L.labels.push({ x: cx, y: yy, text: s.label, cls, size: LABEL, anchor: "middle", bold });
          else yy -= NOTE_LEAD;
          notes.forEach((n) =>
            L.labels.push({ x: cx, y: yy += NOTE_LEAD, text: n, cls: "t-note", size: NOTE, anchor: "middle" })
          );
        }
      }
    });

    if (target) {
      if (square) {
        L.strokes.push({ kind: t.line ?? kindOut, pts: [[target.x, y], [target.x, target.y]] });
        if (t.arrow !== false) {
          const dir = target.y > y ? 1 : -1;
          L.arrows.push({ x: target.x, y: target.y - 11 * dir, dir, kind: t.line ?? kindOut });
        }
      } else if (cOut) {
        L.strokes.push({ kind: kindOut, pts: bezier([runEnd, y], [target.x, target.y]) });
      }
    }
  };

  // place tracks once their "from" and "merge" vertices exist
  while (done.size < spec.tracks.length) {
    let progress = false;
    spec.tracks.forEach((t, i) => {
      if (done.has(i)) return;
      if ((t.from && !pos.has(t.from)) || (t.merge && !pos.has(t.merge))) return;
      place(t);
      done.add(i);
      progress = true;
    });
    if (!progress) {
      const stuck = spec.tracks.filter((_, i) => !done.has(i)).map((t) => t.id ?? `lane ${t.lane}`);
      throw new Error(`cannot place tracks (circular from/merge?): ${stuck.join(", ")}`);
    }
  }
  return L;
}

// ---------- SVG ----------

interface Palette {
  bg: string;
  card: string;
  edge: string;
  ink: string;
  muted: string;
  model: string;
  human: string;
  danger: string;
}
const LIGHT: Palette = {
  bg: "#fafafa",
  card: "#ffffff",
  edge: "#ececec",
  ink: "#1f1f1f",
  muted: "#8a8a8a",
  model: "#4a7bf7",
  human: "#f0a030",
  danger: "#e5484d",
};
const DARK: Palette = {
  bg: "#141414",
  card: "#1b1b1b",
  edge: "#2a2a2a",
  ink: "#e8e8e8",
  muted: "#8f8f8f",
  model: "#7aa2ff",
  human: "#f5b04a",
  danger: "#ff6b6f",
};

/** Literal colors, no CSS variables, so rasterizers like resvg render the same thing browsers do. */
function css(p: Palette): string {
  return `
.bg{fill:${p.bg}} .card{fill:${p.card};stroke:${p.edge}}
.s-code,.s-model,.s-human,.s-wait{fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.s-code{stroke:${p.ink}} .s-model{stroke:${p.model}}
.s-human{stroke:${p.human};stroke-dasharray:9 7;stroke-linecap:butt}
.s-wait{stroke:${p.muted};stroke-dasharray:0.1 7;stroke-width:2.6}
.g-ink,.a-code,.t-ink,.t-code,.t-title{fill:${p.ink}} .g-danger,.t-danger{fill:${p.danger}}
.g-model,.a-model,.t-model{fill:${p.model}} .g-human,.a-human,.t-human{fill:${p.human}} .a-wait,.t-note{fill:${p.muted}}
.g-read{fill:${p.card};stroke:${p.ink};stroke-width:2.4}
.g-trust{fill:${p.card};stroke:${p.human};stroke-width:2.8}
.g-gate{fill:${p.card};stroke:${p.human};stroke-width:2.4}
`;
}

function strokePath(s: Stroke): string {
  const pts = s.kind === "model" ? wave(s.pts) : s.pts;
  return pts.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)} ${r1(y)}`).join("");
}

function glyphSvg(g: Glyph): string {
  const { x, y } = g;
  switch (g.kind) {
    case "read":
      return `<circle cx="${x}" cy="${y}" r="7.5" class="g-read"/>`;
    case "reversible":
      return `<path d="M${x} ${y - 10}L${x + 10} ${y}L${x} ${y + 10}L${x - 10} ${y}Z" class="g-ink"/>`;
    case "irreversible":
      return `<path d="M${x} ${y - 10}L${x + 10} ${y}L${x} ${y + 10}L${x - 10} ${y}Z" class="g-danger"/>`;
    case "trust":
      return `<circle cx="${x}" cy="${y}" r="8" class="g-trust"/>`;
    case "stop":
      return `<rect x="${x - 2}" y="${y - 15}" width="4" height="30" rx="1" class="g-ink"/>`;
    case "branch": {
      const c = g.by === "model" ? "g-model" : g.by === "human" ? "g-human" : "g-ink";
      return `<path d="M${x} ${y - 7.5}L${x + 7.5} ${y}L${x} ${y + 7.5}L${x - 7.5} ${y}Z" class="${c}"/>`;
    }
    case "junction":
      return `<circle cx="${x}" cy="${y}" r="4" class="g-ink"/>`;
    case "gate":
      return `<rect x="${x - 8}" y="${y - 8}" width="16" height="16" class="g-gate"/>`;
  }
}

function labelSvg(l: Label): string {
  return `<text x="${r1(l.x)}" y="${r1(l.y)}" font-size="${l.size}" text-anchor="${l.anchor}" class="${l.cls}"${
    l.bold ? ` font-weight="600"` : ""
  }>${esc(l.text)}</text>`;
}

function labelBox(l: Label): [number, number, number, number] {
  const w = textW(l.text, l.size, l.bold);
  const x0 = l.anchor === "start" ? l.x : l.anchor === "middle" ? l.x - w / 2 : l.x - w;
  return [x0, l.y - l.size, x0 + w, l.y + 4];
}

function legendItems(spec: Spec, L: Layout): { key: LineKind | VertexKind; text: string }[] {
  if (spec.legend === false) return [];
  const used = new Set<string>([...L.strokes.map((s) => s.kind), ...L.glyphs.map((g) => g.kind)]);
  const custom = spec.legend ?? {};
  return LEGEND_ORDER.filter((k) => used.has(k)).map((k) => ({ key: k, text: custom[k] ?? DEFAULT_LEGEND[k] }));
}

function legendSample(key: LineKind | VertexKind, x: number, y: number): string {
  if ((LINE_KINDS as string[]).includes(key)) {
    return `<path d="${strokePath({ kind: key as LineKind, pts: [[x, y], [x + 70, y]] })}" class="s-${key}"/>`;
  }
  return glyphSvg({ kind: key as VertexKind, x: x + 10, y, by: undefined });
}

export function render(spec: Spec, opts: { png?: boolean } = {}): { svg: string; warnings: string[] } {
  const errs = validate(spec);
  if (errs.length) throw new Error(`invalid spec:\n  - ${errs.join("\n  - ")}`);
  const L = layout(spec);

  // bounds of the diagram body
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x0: number, y0: number, x1 = x0, y1 = y0) => {
    minX = Math.min(minX, x0), minY = Math.min(minY, y0), maxX = Math.max(maxX, x1), maxY = Math.max(maxY, y1);
  };
  L.strokes.forEach((s) => s.pts.forEach(([x, y]) => grow(x, y - WAVE_AMP, x, y + WAVE_AMP)));
  L.glyphs.forEach((g) => grow(g.x - 16, g.y - 16, g.x + 16, g.y + 16));
  L.labels.forEach((l) => {
    const [a, b, c, d] = labelBox(l);
    grow(a, b, c, d);
  });

  const pad = 36;
  const bodyW = maxX - minX + pad * 2;
  const timeH = spec.time === false ? 0 : 34;
  const bodyH = maxY - minY + pad * 2 + timeH;

  // legend rows, wrapped to the body width
  const items = legendItems(spec, L);
  const legendRows: { key: LineKind | VertexKind; text: string; x: number }[][] = [];
  const width = Math.max(bodyW, 640);
  {
    let row: { key: LineKind | VertexKind; text: string; x: number }[] = [];
    let x = 24;
    for (const it of items) {
      const sample = (LINE_KINDS as string[]).includes(it.key) ? 82 : 30;
      const w = sample + textW(it.text, LABEL) * 0.92 + 30;
      if (row.length && x + w > width - 24) legendRows.push(row), (row = []), (x = 24);
      row.push({ ...it, x });
      x += w;
    }
    if (row.length) legendRows.push(row);
  }
  const titleH = spec.title ? 44 : 0;
  const legendH = legendRows.length ? legendRows.length * 38 + 22 : 0;
  const gap = legendH ? 18 : 0;
  const top = titleH + legendH + gap;
  const H = top + bodyH;
  const ox = pad - minX + (width - bodyW) / 2, oy = top + pad - minY;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r1(width)} ${r1(H)}" width="${r1(width)}" height="${
      r1(H)
    }" ` +
      `font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">`,
  );
  if (spec.title) out.push(`<title>${esc(spec.title)}</title>`);
  out.push(`<style>${css(LIGHT)}${
    opts.png ? "" : `
@media (prefers-color-scheme: dark) {${css(DARK)}}`
  }</style>`);
  out.push(`<rect class="bg" width="100%" height="100%"/>`);
  if (spec.title) {
    out.push(`<text x="24" y="32" font-size="20" font-weight="650" class="t-title">${esc(spec.title)}</text>`);
  }
  if (legendRows.length) {
    out.push(`<rect class="card" x="8" y="${titleH + 8}" width="${r1(width - 16)}" height="${legendH - 8}" rx="10"/>`);
    legendRows.forEach((row, ri) => {
      const y = titleH + 8 + 26 + ri * 38;
      row.forEach((it) => {
        const isL = (LINE_KINDS as string[]).includes(it.key);
        out.push(legendSample(it.key, it.x, y));
        out.push(
          labelSvg({ x: it.x + (isL ? 82 : 30), y: y + 5, text: it.text, cls: "t-ink", size: LABEL, anchor: "start" }),
        );
      });
    });
  }
  out.push(`<rect class="card" x="8" y="${r1(top)}" width="${r1(width - 16)}" height="${r1(bodyH - 8)}" rx="12"/>`);
  out.push(`<g transform="translate(${r1(ox)} ${r1(oy)})">`);
  L.strokes.forEach((s) => out.push(`<path d="${strokePath(s)}" class="s-${s.kind}"/>`));
  L.arrows.forEach((a) => {
    const d = a.dir;
    out.push(
      `<path d="M${a.x - 5} ${a.y - 6 * d}L${a.x + 5} ${a.y - 6 * d}L${a.x} ${a.y + 2 * d}Z" class="a-${a.kind}"/>`,
    );
  });
  L.glyphs.forEach((g) => out.push(glyphSvg(g)));
  L.labels.forEach((l) => out.push(labelSvg(l)));
  out.push(`</g>`);
  if (spec.time !== false) {
    out.push(
      labelSvg({ x: 30, y: H - 24, text: `${spec.time ?? "time"} →`, cls: "t-note", size: NOTE, anchor: "start" }),
    );
  }
  out.push(`</svg>`);
  return { svg: out.join("\n") + "\n", warnings: L.warnings };
}

// ---------- CLI ----------

if (import.meta.main) {
  const args = [...Deno.args];
  const take = (flag: string) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const outPath = take("-o") ?? take("--out");
  const pngPath = take("--png");
  const input = args[0];
  if (!input) {
    console.error("usage: render.ts <spec.json> [-o out.svg] [--png out.png]");
    Deno.exit(2);
  }
  const spec = JSON.parse(await Deno.readTextFile(input)) as Spec;
  let result;
  try {
    result = render(spec);
  } catch (e) {
    console.error((e as Error).message);
    Deno.exit(1);
  }
  for (const w of result.warnings) console.error(`warning: ${w}`);
  const svgPath = outPath ?? input.replace(/\.json$/i, "") + ".svg";
  await Deno.writeTextFile(svgPath, result.svg);
  console.log(`wrote ${svgPath}`);
  if (pngPath) {
    const { Resvg } = await import("npm:@resvg/resvg-js@2.6.2");
    const png = new Resvg(render(spec, { png: true }).svg, {
      fitTo: { mode: "zoom", value: 2 },
      font: { loadSystemFonts: true },
    }).render().asPng();
    await Deno.writeFile(pngPath, png);
    console.log(`wrote ${pngPath}`);
  }
}
