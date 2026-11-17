#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * Feynman diagram renderer: turns a semantic spec (JSON) into an SVG.
 *
 * A diagram is a set of horizontal tracks through time. Lines are stretches of
 * time; vertices are moments. The spec declares its own *vocabulary*: which
 * kinds of line and vertex exist in this domain, what each means, and which
 * visual primitive (stroke style, glyph shape, color) carries it. Presets
 * supply ready vocabularies (`agent`, `qed`); any domain can define its own.
 *
 * The spec says *what happens*. This script owns *where it goes*: lanes,
 * spacing, curves, labels, legend, and theme. See ../references/spec.md.
 *
 * Usage:
 *   deno run --allow-read --allow-write render.ts <spec.json> [-o out.svg] [--png out.png]
 */

// ---------- spec types ----------

type Text = string | string[];

export type StrokeStyle = "solid" | "wave" | "coil" | "zigzag" | "dashed" | "dotted" | "double";
export type Shape = "circle" | "diamond" | "square" | "triangle" | "hexagon" | "star" | "cross" | "dot" | "bar";
export type LabelPos = "above" | "below" | "right" | "above-left";

/** A palette token (adapts to dark mode) or a literal #hex color. */
export type Color = "ink" | "gray" | "blue" | "orange" | "red" | "green" | "purple" | "teal" | "pink" | `#${string}`;

export interface LineDef {
  stroke: StrokeStyle;
  color?: Color;
  /** Draw a direction chevron on each stretch of this kind (e.g. a fermion's arrow, a cash flow). */
  arrow?: boolean;
  legend?: string;
  /** Default length of a stretch of this kind, in px. */
  len?: number;
}

export interface VertexDef {
  shape: Shape;
  fill?: "solid" | "hollow";
  color?: Color;
  size?: number;
  legend?: string;
  /** Color this vertex's label with the vertex's own color. */
  labelColor?: boolean;
  bold?: boolean;
  labelPos?: LabelPos;
}

export interface LineStep {
  line: string;
  label?: string;
  note?: Text;
  len?: number;
  probe?: Probe;
}

export interface VertexStep {
  vertex: string;
  id?: string;
  label?: string;
  note?: Text;
  /** On a `branch`: the line kind whose agent chose the route; colors the branch and its route labels. */
  by?: string;
  labelPos?: LabelPos;
}

export interface Probe {
  vertex?: string;
  line?: string;
  label?: string;
  note?: Text;
  height?: number;
  side?: "above" | "below";
  /** Where along the line the probe leaves, 0..1. */
  at?: number;
}

export type Step = LineStep | VertexStep;

export interface Track {
  id?: string;
  lane: number;
  line?: string;
  from?: string;
  merge?: string;
  start?: { label: string; note?: Text };
  end?: { label: string; note?: Text };
  /** Px from the left margin where a track with no `start` or `from` begins. */
  offset?: number;
  label?: string;
  note?: Text;
  shape?: "curve" | "square" | "straight";
  /** Arrowhead into a square merge (default true). */
  arrow?: boolean;
  /** Flip direction chevrons on this track (e.g. an antiparticle, a refund). */
  reverse?: boolean;
  steps?: Step[];
}

export interface Spec {
  title?: string;
  preset?: "agent" | "qed" | "none";
  lines?: Record<string, LineDef>;
  vertices?: Record<string, VertexDef>;
  /** Override legend text per kind, or false to hide the legend. */
  legend?: false | Record<string, string>;
  /** Caption for the left-to-right axis (default "time"), or false. */
  time?: false | string;
  lanePx?: number;
  tracks: Track[];
}

// ---------- vocabulary ----------

interface Vocab {
  lines: Record<string, LineDef>;
  vertices: Record<string, VertexDef>;
}

export const PRESETS: Record<string, Vocab> = {
  none: { lines: {}, vertices: {} },
  agent: {
    lines: {
      code: { stroke: "solid", color: "ink", legend: "code decides", len: 90 },
      model: { stroke: "wave", color: "blue", legend: "the model decides", len: 220 },
      human: { stroke: "dashed", color: "orange", legend: "a human decides", len: 120 },
      wait: { stroke: "dotted", color: "gray", legend: "asleep, waiting", len: 200 },
    },
    vertices: {
      read: { shape: "circle", fill: "hollow", color: "ink", legend: "reads the world" },
      reversible: { shape: "diamond", color: "ink", legend: "changes the world, can be undone" },
      irreversible: {
        shape: "diamond",
        color: "red",
        legend: "changes the world, cannot be undone",
        labelColor: true,
        bold: true,
      },
      gate: {
        shape: "square",
        fill: "hollow",
        color: "orange",
        legend: "asks a human",
        labelColor: true,
        bold: true,
        labelPos: "above-left",
      },
      trust: { shape: "circle", fill: "hollow", color: "orange", legend: "temporary trust", labelColor: true },
    },
  },
  qed: {
    lines: {
      fermion: { stroke: "solid", color: "ink", arrow: true, legend: "fermion (arrow: particle flow)", len: 140 },
      photon: { stroke: "wave", color: "ink", legend: "photon", len: 160 },
      gluon: { stroke: "coil", color: "ink", legend: "gluon", len: 160 },
      boson: { stroke: "zigzag", color: "ink", legend: "W / Z boson", len: 160 },
      scalar: { stroke: "dashed", color: "ink", legend: "scalar (Higgs)", len: 140 },
    },
    vertices: {
      vertex: { shape: "dot", color: "ink", size: 11, legend: "interaction vertex" },
      blob: { shape: "circle", color: "gray", size: 16, legend: "unresolved process" },
    },
  },
};

/** Structural vertices every diagram has. */
const BUILTIN_VERTICES: Record<string, VertexDef> = {
  branch: { shape: "diamond", color: "ink", size: 7.5 },
  junction: { shape: "dot", color: "ink", size: 9 },
  stop: { shape: "bar", color: "ink", legend: "stops", labelPos: "right" },
};

function vocabOf(spec: Spec): Vocab {
  const base = PRESETS[spec.preset ?? "none"] ?? PRESETS.none;
  return {
    lines: { ...base.lines, ...spec.lines },
    vertices: { ...BUILTIN_VERTICES, ...base.vertices, ...spec.vertices },
  };
}

// ---------- constants ----------

const STROKES: StrokeStyle[] = ["solid", "wave", "coil", "zigzag", "dashed", "dotted", "double"];
const SHAPES: Shape[] = ["circle", "diamond", "square", "triangle", "hexagon", "star", "cross", "dot", "bar"];
const TOKENS = ["ink", "gray", "blue", "orange", "red", "green", "purple", "teal", "pink"];

const DEFAULT_LEN = 110;
const IMPLICIT_LEN = 56;
const MARGIN = 40;
const LABEL = 15;
const NOTE = 13;
const NOTE_LEAD = 17;
const WAVE_AMP = 6;
const WAVE_LEN = 22;
/** Monospace faces that cover arrows and math symbols, first; Cascadia/Consolas lack them. */
const MONO = "Menlo, 'DejaVu Sans Mono', 'MS Gothic', ui-monospace, monospace";
/** Sans first; anything the sans faces lack falls back to monospace, never serif. */
const FONT = `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, ${MONO}`;

// ---------- small helpers ----------

type Pt = [number, number];

const lines = (t?: Text): string[] => (t === undefined ? [] : Array.isArray(t) ? t : [t]);
const textW = (s: string, size: number, bold = false) => s.length * size * (bold ? 0.6 : 0.54);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isLine = (s: Step): s is LineStep => "line" in s;
const r1 = (n: number) => Math.round(n * 10) / 10;
const validColor = (c: unknown) => typeof c === "string" && (TOKENS.includes(c) || /^#[0-9a-f]{3,8}$/i.test(c));

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

/** Resample a polyline densely, returning points, their arc length, and unit tangents. */
function dense(pts: Pt[]): { p: Pt; s: number; tx: number; ty: number }[] {
  const d: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 1.5));
    for (let k = 1; k <= n; k++) d.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
  }
  let s = 0;
  return d.map((p, i) => {
    if (i > 0) s += Math.hypot(p[0] - d[i - 1][0], p[1] - d[i - 1][1]);
    const a = d[Math.max(0, i - 1)], b = d[Math.min(d.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { p, s, tx: (b[0] - a[0]) / len, ty: (b[1] - a[1]) / len };
  });
}

/** Displace a polyline for wave, coil, and zigzag strokes. */
function displace(pts: Pt[], style: StrokeStyle): Pt[] {
  if (style !== "wave" && style !== "coil" && style !== "zigzag") return pts;
  return dense(pts).map(({ p, s, tx, ty }) => {
    const nx = -ty, ny = tx;
    if (style === "wave") {
      const o = WAVE_AMP * Math.sin((2 * Math.PI * s) / WAVE_LEN);
      return [p[0] + nx * o, p[1] + ny * o];
    }
    if (style === "zigzag") {
      const ph = (s / 16) % 1;
      const o = WAVE_AMP * (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph);
      return [p[0] + nx * o, p[1] + ny * o];
    }
    // coil: a loop every 13px (gluon)
    const a = (2 * Math.PI * s) / 13;
    const o = 7 * Math.sin(a), q = -7 * Math.cos(a) + 7;
    return [p[0] + nx * o + tx * q * 0.9, p[1] + ny * o + ty * q * 0.9];
  });
}

// ---------- validation ----------

export function validate(spec: Spec): string[] {
  const errs: string[] = [];
  if (!spec || !Array.isArray(spec.tracks) || spec.tracks.length === 0) {
    return ["spec.tracks must be a non-empty array"];
  }
  if (spec.preset && !PRESETS[spec.preset]) {
    errs.push(`unknown preset "${spec.preset}" (have: ${Object.keys(PRESETS).join(", ")})`);
  }
  for (const [k, d] of Object.entries(spec.lines ?? {})) {
    if (!STROKES.includes(d.stroke)) errs.push(`lines.${k}: stroke must be one of ${STROKES.join(", ")}`);
    if (d.color && !validColor(d.color)) errs.push(`lines.${k}: color must be a #hex or one of ${TOKENS.join(", ")}`);
  }
  for (const [k, d] of Object.entries(spec.vertices ?? {})) {
    if (!SHAPES.includes(d.shape)) errs.push(`vertices.${k}: shape must be one of ${SHAPES.join(", ")}`);
    if (d.color && !validColor(d.color)) {
      errs.push(`vertices.${k}: color must be a #hex or one of ${TOKENS.join(", ")}`);
    }
  }
  const V = vocabOf(spec);
  const lineNames = Object.keys(V.lines);
  if (!lineNames.length) errs.push(`no line kinds: set "preset" or define "lines"`);
  const lk = (k: string | undefined, at: string) => {
    if (k !== undefined && !V.lines[k]) errs.push(`${at}: unknown line kind "${k}" (have: ${lineNames.join(", ")})`);
  };
  const vk = (k: string | undefined, at: string) => {
    if (k !== undefined && !V.vertices[k]) {
      errs.push(`${at}: unknown vertex kind "${k}" (have: ${Object.keys(V.vertices).join(", ")})`);
    }
  };
  const ids = new Set<string>();
  spec.tracks.forEach((t, i) => {
    const at = `tracks[${i}]${t.id ? ` (${t.id})` : ""}`;
    if (typeof t.lane !== "number") errs.push(`${at}: lane must be a number`);
    lk(t.line, at);
    (t.steps ?? []).forEach((s, j) => {
      const sat = `${at}.steps[${j}]`;
      if (isLine(s)) {
        lk(s.line, sat);
        if (s.probe) lk(s.probe.line, `${sat}.probe`), vk(s.probe.vertex, `${sat}.probe`);
      } else if ("vertex" in s) {
        vk(s.vertex, sat);
        if (s.by !== undefined && !V.lines[s.by] && !validColor(s.by)) {
          errs.push(`${sat}.by: "${s.by}" is neither a line kind (${lineNames.join(", ")}) nor a color`);
        }
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
  kind: string;
  pts: Pt[];
  reverse?: boolean;
}
interface Glyph {
  kind: string;
  x: number;
  y: number;
  by?: string;
}
interface Label {
  x: number;
  y: number;
  text: string;
  color: Color;
  size: number;
  anchor: "start" | "middle" | "end";
  bold?: boolean;
}
interface Arrow {
  x: number;
  y: number;
  dir: 1 | -1;
  color: Color;
}

interface Layout {
  strokes: Stroke[];
  glyphs: Glyph[];
  labels: Label[];
  arrows: Arrow[];
  warnings: string[];
}

export function layout(spec: Spec): Layout {
  const V = vocabOf(spec);
  const lanePx = spec.lanePx ?? 115;
  const firstLine = Object.keys(V.lines)[0];
  const L: Layout = { strokes: [], glyphs: [], labels: [], arrows: [], warnings: [] };
  const pos = new Map<string, { x: number; y: number; by?: string }>();
  const done = new Set<number>();
  const implicitSteps = new WeakSet<Step>();

  /** A line kind's color; a `by` may also name a color directly. */
  const lineColor = (k: string): Color => V.lines[k]?.color ?? (validColor(k) ? (k as Color) : "ink");
  const vdef = (k: string) => V.vertices[k];
  const labelPosOf = (v: VertexStep): LabelPos => v.labelPos ?? vdef(v.vertex).labelPos ?? "below";
  const textBlockW = (v: VertexStep) =>
    Math.max(0, ...[...(v.label ? [textW(v.label, LABEL, true)] : []), ...lines(v.note).map((n) => textW(n, NOTE))]);

  /** Half the width of a vertex's below-the-line text, which a line's own note must stay clear of. */
  const belowHalf = (v: Step | undefined) =>
    !v || isLine(v) || labelPosOf(v) !== "below" || !textBlockW(v) ? 0 : textBlockW(v) / 2 + 8;
  /** Width of a vertex's above-left label, which hangs back over the preceding line. */
  const aboveLeftW = (v: Step | undefined) =>
    !v || isLine(v) || labelPosOf(v) !== "above-left" || !textBlockW(v) ? 0 : textBlockW(v) + 14;
  const insets = (steps: Step[], i: number): [number, number] =>
    lines((steps[i] as LineStep).note).length ? [belowHalf(steps[i - 1]), belowHalf(steps[i + 1])] : [0, 0];

  const naturalLen = (steps: Step[], i: number) => {
    const s = steps[i] as LineStep;
    if (s.len !== undefined) return s.len;
    const [a, b] = insets(steps, i);
    return Math.max(
      V.lines[s.line]?.len ?? DEFAULT_LEN,
      s.label ? textW(s.label, LABEL, true) + 28 + aboveLeftW(steps[i + 1]) : 0,
      ...lines(s.note).map((n) => textW(n, NOTE) + 24 + a + b),
    );
  };

  const normalize = (t: Track): Step[] => {
    const implicit = (): LineStep => {
      const s: LineStep = { line: t.line ?? firstLine, len: IMPLICIT_LEN };
      implicitSteps.add(s);
      return s;
    };
    const out: Step[] = [];
    (t.steps ?? []).forEach((s, i) => {
      const prev = out[out.length - 1];
      // a free-standing track (no start, no from) may begin right on a vertex
      const freeStart = i === 0 && !t.start && !t.from;
      if (!isLine(s) && !freeStart && (!prev || !isLine(prev))) out.push(implicit());
      out.push(s);
    });
    const last = out[out.length - 1];
    if (t.merge && last && !isLine(last)) out.push(implicit());
    return out;
  };

  const textStack = (
    x: number,
    y: number,
    label: string | undefined,
    notes: string[],
    color: Color,
    anchor: Label["anchor"],
    up: boolean,
    bold = true,
  ) => {
    const n = (label ? 1 : 0) + notes.length;
    let yy = up ? y - (n - 1) * NOTE_LEAD : y;
    if (label) L.labels.push({ x, y: yy, text: label, color, size: LABEL, anchor, bold }), (yy += NOTE_LEAD);
    for (const t of notes) L.labels.push({ x, y: yy, text: t, color: "gray", size: NOTE, anchor }), (yy += NOTE_LEAD);
  };

  const place = (t: Track) => {
    const y = t.lane * lanePx;
    const steps = normalize(t);
    const lineSteps = steps.filter(isLine);
    const kindIn = lineSteps[0]?.line ?? t.line ?? firstLine;
    const kindOut = lineSteps[lineSteps.length - 1]?.line ?? t.line ?? firstLine;
    const square = t.shape === "square";
    const straight = t.shape === "straight";
    const parent = t.from ? pos.get(t.from)! : undefined;
    const rev = t.reverse;
    const conn = (a: Pt, b: Pt): Pt[] => (straight ? [a, b] : bezier(a, b));
    const connLen = (dy: number) => (straight ? Math.abs(dy) * 0.9 + 20 : Math.min(150, 46 + Math.abs(dy) * 0.42));
    const titleColor = (k: string): Color => (lineColor(k) === "gray" ? "ink" : lineColor(k));

    let runStart: number;
    if (parent) {
      if (square && parent.y !== y) {
        L.strokes.push({ kind: t.line ?? kindIn, pts: [[parent.x, parent.y], [parent.x, y]], reverse: rev });
        runStart = parent.x;
      } else if (parent.y !== y) {
        const c = connLen(y - parent.y);
        L.strokes.push({ kind: kindIn, pts: conn([parent.x, parent.y], [parent.x + c, y]), reverse: rev });
        runStart = parent.x + c;
      } else runStart = parent.x;
    } else {
      runStart = MARGIN + (t.offset ?? 0);
      if (t.start) {
        // trigger label: lanes above the main path stack text above; below stack below; on it, split
        const s = t.start, notes = lines(s.note), color = titleColor(t.line ?? kindIn), x = runStart - 4;
        if (t.lane < 0) textStack(x, y - 14, s.label, notes, color, "start", true);
        else if (t.lane > 0) textStack(x, y + 26, s.label, notes, color, "start", false);
        else {
          L.labels.push({ x, y: y - 14, text: s.label, color, size: LABEL, anchor: "start", bold: true });
          textStack(x, y + 26, undefined, notes, color, "start", false);
        }
      }
    }

    const widths = steps.map((s, i) => (isLine(s) ? naturalLen(steps, i) : 0));
    // a trigger's own label sits over the first stretch, so that stretch must be at least as wide
    if (t.start && !t.merge && steps[0] && implicitSteps.has(steps[0])) {
      const need = Math.max(textW(t.start.label, LABEL, true), ...lines(t.start.note).map((n) => textW(n, NOTE)));
      widths[0] = Math.max(widths[0], need + 18 + belowHalf(steps[1]));
    }
    const target = t.merge ? pos.get(t.merge)! : undefined;
    let runEnd = runStart + widths.reduce((a, b) => a + b, 0);
    let cOut = 0;
    if (target) {
      cOut = square || target.y === y ? 0 : connLen(target.y - y);
      runEnd = target.x - cOut;
      // a trigger with nothing on it is one sweep into its target
      if (steps.length === 0 && !parent && !square) {
        L.strokes.push({ kind: t.line ?? firstLine, pts: conn([runStart, y], [target.x, target.y]), reverse: rev });
        return;
      }
      const nat = widths.reduce((a, b) => a + b, 0);
      const avail = runEnd - runStart;
      if (avail < nat - 1) {
        L.warnings.push(
          `track ${t.id ?? `lane ${t.lane}`}: needs ${Math.ceil(nat)}px before merging into "${t.merge}" but has ` +
            `${Math.floor(avail)}px; lengthen the line before "${t.merge}" (len) or shorten this track`,
        );
      }
      if (nat > 0) widths.forEach((w, i) => (widths[i] = (w * avail) / nat));
      else if (avail > 0) {
        L.strokes.push({ kind: t.line ?? firstLine, pts: [[runStart, y], [runEnd, y]], reverse: rev });
      }
    }

    // track label (+ note) centered over the first stretch
    if (t.label) {
      const i0 = steps.findIndex(isLine);
      let x0 = runStart, x1 = runEnd;
      if (i0 >= 0) {
        x0 = runStart + widths.slice(0, i0).reduce((a, b) => a + b, 0);
        x1 = x0 + widths[i0];
      }
      const color = parent?.by ? lineColor(parent.by) : titleColor(t.line ?? kindIn);
      textStack(
        (x0 + x1) / 2,
        y - 14 - lines(t.note).length * NOTE_LEAD,
        t.label,
        lines(t.note),
        color,
        "middle",
        false,
      );
    }

    let cx = runStart;
    let lastBranch: string | undefined = parent?.by;
    steps.forEach((s, i) => {
      const w = widths[i];
      if (isLine(s)) {
        L.strokes.push({ kind: s.line, pts: [[cx, y], [cx + w, y]], reverse: rev });
        const mid = cx + (w - (s.label ? aboveLeftW(steps[i + 1]) : 0)) / 2;
        if (s.label) {
          const own = lineColor(s.line);
          const color: Color = lastBranch ? lineColor(lastBranch) : own === "gray" ? "ink" : own;
          L.labels.push({
            x: mid,
            y: y - 16,
            text: s.label,
            color,
            size: LABEL,
            anchor: "middle",
            bold: color !== "ink" || !!lastBranch,
          });
        }
        const [ia, ib] = insets(steps, i);
        textStack(cx + ia + (w - ia - ib) / 2, y + 30, undefined, lines(s.note), "gray", "middle", false);
        if (s.probe) {
          const p = s.probe;
          // default: right of center, clear of a centered stretch label
          const clear = s.label ? (textW(s.label, LABEL, true) / 2 + 16) / w : 0;
          const px = cx + w * (p.at ?? Math.min(0.85, Math.max(0.62, 0.5 + clear)));
          const h = (p.height ?? 70) * (p.side === "below" ? 1 : -1);
          L.strokes.push({ kind: p.line ?? s.line, pts: [[px, y], [px, y + h]] });
          L.glyphs.push({ kind: p.vertex ?? "junction", x: px, y: y + h });
          const pl = [...(p.label ? [p.label] : []), ...lines(p.note)];
          pl.forEach((n, k) =>
            L.labels.push({
              x: px + 16,
              y: y + h - 4 + k * NOTE_LEAD,
              text: n,
              color: "gray",
              size: NOTE,
              anchor: "start",
            })
          );
        }
        lastBranch = undefined;
        cx += w;
      } else {
        const d = vdef(s.vertex);
        L.glyphs.push({ kind: s.vertex, x: cx, y, by: s.by });
        if (s.id) pos.set(s.id, { x: cx, y, by: s.by });
        if (s.vertex === "branch") lastBranch = s.by;
        const where = labelPosOf(s);
        const notes = lines(s.note);
        const color: Color = d.labelColor ? (d.color ?? "ink") : "ink";
        const bold = !!d.bold;
        const r = (d.size ?? 9) + 5;
        if (where === "right") {
          if (s.label) L.labels.push({ x: cx + r, y: y + 5, text: s.label, color, size: LABEL, anchor: "start", bold });
          textStack(cx + r, y + 5 + (s.label ? NOTE_LEAD : 0), undefined, notes, color, "start", false);
        } else if (where === "above" || where === "above-left") {
          const left = where === "above-left";
          const top = y - (left ? 26 : r + 8) - notes.length * NOTE_LEAD;
          if (s.label) {
            L.labels.push({
              x: left ? cx - 6 : cx,
              y: top,
              text: s.label,
              color,
              size: LABEL,
              anchor: left ? "end" : "middle",
              bold,
            });
          }
          textStack(
            left ? cx - 6 : cx,
            top + (s.label ? NOTE_LEAD : 0),
            undefined,
            notes,
            color,
            left ? "end" : "middle",
            false,
          );
        } else {
          const top = y + r + 18;
          if (s.label) L.labels.push({ x: cx, y: top, text: s.label, color, size: LABEL, anchor: "middle", bold });
          textStack(cx, top + (s.label ? NOTE_LEAD : 0), undefined, notes, color, "middle", false);
        }
      }
    });

    const endX = cx;
    if (target) {
      if (square) {
        L.strokes.push({ kind: t.line ?? kindOut, pts: [[target.x, y], [target.x, target.y]] });
        if (t.arrow !== false) {
          const dir = target.y > y ? 1 : -1;
          L.arrows.push({ x: target.x, y: target.y - 11 * dir, dir, color: lineColor(t.line ?? kindOut) });
        }
      } else if (cOut) {
        L.strokes.push({ kind: kindOut, pts: conn([runEnd, y], [target.x, target.y]), reverse: rev });
      }
    } else if (t.end) {
      textStack(endX + 12, y + 5, t.end.label, lines(t.end.note), titleColor(kindOut), "start", false);
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

type Palette = Record<(typeof TOKENS)[number] | "bg" | "card" | "edge", string>;
const LIGHT: Palette = {
  bg: "#fafafa",
  card: "#ffffff",
  edge: "#ececec",
  ink: "#1f1f1f",
  gray: "#8a8a8a",
  blue: "#4a7bf7",
  orange: "#f0a030",
  red: "#e5484d",
  green: "#2f9e5b",
  purple: "#8b5cf6",
  teal: "#0f9fa8",
  pink: "#e04f9b",
};
const DARK: Palette = {
  bg: "#141414",
  card: "#1b1b1b",
  edge: "#2a2a2a",
  ink: "#e8e8e8",
  gray: "#8f8f8f",
  blue: "#7aa2ff",
  orange: "#f5b04a",
  red: "#ff6b6f",
  green: "#4cc47e",
  purple: "#a98bff",
  teal: "#3cc4cc",
  pink: "#f27ab8",
};

/** Literal colors, no CSS variables, so rasterizers like resvg render the same thing browsers do. */
function css(p: Palette): string {
  const rules = [
    `.bg{fill:${p.bg}}`,
    `.card{fill:${p.card};stroke:${p.edge}}`,
    `.f-card{fill:${p.card}}`,
    `.k-card{stroke:${p.card}}`,
  ];
  for (const t of TOKENS) rules.push(`.f-${t}{fill:${p[t]}}`, `.k-${t}{stroke:${p[t]}}`);
  return "\n" + rules.join("\n") + "\n";
}

const fillAttr = (c: Color) => (c.startsWith("#") ? `fill="${c}"` : `class="f-${c}"`);
const strokeCls = (c: Color) => (c.startsWith("#") ? { cls: "", attr: ` stroke="${c}"` } : { cls: `k-${c}`, attr: "" });

function pathD(pts: Pt[]) {
  return pts.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)} ${r1(y)}`).join("");
}

function strokeSvg(V: Vocab, s: Stroke): string {
  const d = V.lines[s.kind];
  const color = d.color ?? "ink";
  const { cls, attr } = strokeCls(color);
  const dpath = pathD(displace(s.pts, d.stroke));
  const base = `fill="none" stroke-linejoin="round"`;
  let out: string;
  switch (d.stroke) {
    case "dashed":
      out = `<path d="${dpath}" ${base} stroke-width="2.2" stroke-dasharray="9 7" class="${cls}"${attr}/>`;
      break;
    case "dotted":
      out =
        `<path d="${dpath}" ${base} stroke-width="2.6" stroke-linecap="round" stroke-dasharray="0.1 7" class="${cls}"${attr}/>`;
      break;
    case "double":
      out = `<path d="${dpath}" ${base} stroke-width="6.5" class="${cls}"${attr}/>` +
        `<path d="${dpath}" ${base} stroke-width="2.3" class="k-card"/>`;
      break;
    default:
      out = `<path d="${dpath}" ${base} stroke-width="2.2" stroke-linecap="round" class="${cls}"${attr}/>`;
  }
  if (d.arrow) out += chevron(s.pts, color, !!s.reverse);
  return out;
}

/** A direction chevron at the stroke's midpoint (by arc length), pointing along it. */
function chevron(pts: Pt[], color: Color, reverse: boolean): string {
  const ds = dense(pts);
  const total = ds[ds.length - 1].s;
  if (total < 24) return "";
  const m = ds.find((q) => q.s >= total / 2) ?? ds[ds.length - 1];
  const sgn = reverse ? -1 : 1;
  const tx = m.tx * sgn, ty = m.ty * sgn, nx = -ty, ny = tx;
  const [x, y] = m.p;
  const tip: Pt = [x + tx * 6, y + ty * 6];
  const a: Pt = [x - tx * 5 + nx * 6, y - ty * 5 + ny * 6];
  const b: Pt = [x - tx * 5 - nx * 6, y - ty * 5 - ny * 6];
  return `<path d="${pathD([a, tip, b])}Z" ${fillAttr(color)}/>`;
}

function glyphSvg(V: Vocab, g: Glyph): string {
  const d = V.vertices[g.kind];
  let color: Color = d.color ?? "ink";
  if (g.kind === "branch" && g.by) color = V.lines[g.by]?.color ?? (validColor(g.by) ? (g.by as Color) : color);
  const hollow = d.fill === "hollow";
  const s = d.size ?? 9;
  const { x, y } = g;
  const { cls, attr } = strokeCls(color);
  const paint = hollow
    ? `class="f-card ${cls}"${attr} stroke-width="2.5" stroke-linejoin="round"`
    : `${fillAttr(color)}`;
  const poly = (ps: Pt[]) => `<path d="${pathD(ps)}Z" ${paint}/>`;
  switch (d.shape) {
    case "circle":
      return `<circle cx="${x}" cy="${y}" r="${r1(s * 0.83)}" ${paint}/>`;
    case "dot":
      return `<circle cx="${x}" cy="${y}" r="${r1(s * 0.45)}" ${paint}/>`;
    case "diamond":
      return poly([[x, y - s - 1], [x + s + 1, y], [x, y + s + 1], [x - s - 1, y]]);
    case "square": {
      const h = s * 0.9;
      return poly([[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]]);
    }
    case "triangle":
      return poly([[x, y - s * 1.05], [x + s, y + s * 0.75], [x - s, y + s * 0.75]]);
    case "hexagon":
      return poly(
        Array.from(
          { length: 6 },
          (_, i) => [x + s * Math.cos((Math.PI / 3) * i), y + s * Math.sin((Math.PI / 3) * i)] as Pt,
        ),
      );
    case "star":
      return poly(Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 ? s * 0.48 : s * 1.15, a = -Math.PI / 2 + (Math.PI / 5) * i;
        return [x + r * Math.cos(a), y + r * Math.sin(a)] as Pt;
      }));
    case "cross": {
      const h = s * 0.8;
      return `<path d="M${x - h} ${y - h}L${x + h} ${y + h}M${x + h} ${y - h}L${x - h} ${
        y + h
      }" stroke-width="3" stroke-linecap="round" class="${cls}"${attr}/>`;
    }
    case "bar":
      return `<rect x="${x - 2}" y="${y - 15}" width="4" height="30" rx="1" ${fillAttr(color)}/>`;
  }
}

/** Symbol blocks (arrows, math operators, technical, shapes, dingbats) that sans faces often lack. */
const SYMBOLS = /[←-⏿■-➿⤀-⯿]+/g;

/** Escape text and set symbol runs in monospace, so a missing glyph never falls back to a serif face. */
function textContent(s: string): string {
  let out = "", last = 0;
  for (const m of s.matchAll(SYMBOLS)) {
    out += esc(s.slice(last, m.index)) + `<tspan font-family="${MONO}">${esc(m[0])}</tspan>`;
    last = m.index! + m[0].length;
  }
  return out + esc(s.slice(last));
}

/**
 * Browsers fall back per glyph, so only the symbol run goes monospace. resvg switches a whole <text> to its fallback
 * face when any glyph is missing (a tspan does not stop it), so for PNG a line with symbols is set in monospace.
 * resvg also honors only the first family in a list, so PNG names one installed monospace face.
 */
function labelSvg(l: Label, png = false): string {
  const sym = png && new RegExp(SYMBOLS.source).test(l.text);
  return `<text x="${r1(l.x)}" y="${r1(l.y)}" font-size="${l.size}" text-anchor="${l.anchor}" ${fillAttr(l.color)}${
    l.bold ? ` font-weight="600"` : ""
  }${sym ? ` font-family="${pngMono()}"` : ""}>${sym ? esc(l.text) : textContent(l.text)}</text>`;
}

function labelBox(l: Label): [number, number, number, number] {
  const w = textW(l.text, l.size, l.bold);
  const x0 = l.anchor === "start" ? l.x : l.anchor === "middle" ? l.x - w / 2 : l.x - w;
  return [x0, l.y - l.size, x0 + w, l.y + 4];
}

interface LegendItem {
  kind: string;
  isLine: boolean;
  text: string;
}

function legendItems(spec: Spec, V: Vocab, L: Layout): LegendItem[] {
  if (spec.legend === false) return [];
  const usedL = new Set(L.strokes.map((s) => s.kind));
  const usedV = new Set(L.glyphs.map((g) => g.kind));
  const custom = spec.legend ?? {};
  const out: LegendItem[] = [];
  for (const [k, d] of Object.entries(V.lines)) {
    if (usedL.has(k)) out.push({ kind: k, isLine: true, text: custom[k] ?? d.legend ?? k });
  }
  for (const [k, d] of Object.entries(V.vertices)) {
    if (k === "stop" || !usedV.has(k)) continue;
    const text = custom[k] ?? d.legend;
    if (text) out.push({ kind: k, isLine: false, text });
  }
  if (usedV.has("stop")) out.push({ kind: "stop", isLine: false, text: custom.stop ?? "stops" });
  return out;
}

export function render(spec: Spec, opts: { png?: boolean } = {}): { svg: string; warnings: string[] } {
  const errs = validate(spec);
  if (errs.length) throw new Error(`invalid spec:\n  - ${errs.join("\n  - ")}`);
  const V = vocabOf(spec);
  const L = layout(spec);

  // bounds of the diagram body
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x0: number, y0: number, x1 = x0, y1 = y0) => {
    minX = Math.min(minX, x0), minY = Math.min(minY, y0), maxX = Math.max(maxX, x1), maxY = Math.max(maxY, y1);
  };
  L.strokes.forEach((s) => s.pts.forEach(([x, y]) => grow(x - 8, y - 8, x + 8, y + 8)));
  L.glyphs.forEach((g) => grow(g.x - 18, g.y - 18, g.x + 18, g.y + 18));
  L.labels.forEach((l) => {
    const [a, b, c, d] = labelBox(l);
    grow(a, b, c, d);
  });

  const pad = 36;
  const bodyW = maxX - minX + pad * 2;
  const timeH = spec.time === false ? 0 : 34;
  const bodyH = maxY - minY + pad * 2 + timeH;

  // legend rows, wrapped to the body width
  const items = legendItems(spec, V, L);
  const rows: (LegendItem & { x: number })[][] = [];
  const width = Math.max(bodyW, 640);
  {
    let row: (LegendItem & { x: number })[] = [];
    let x = 24;
    for (const it of items) {
      const w = (it.isLine ? 82 : 30) + textW(it.text, LABEL) * 0.92 + 30;
      if (row.length && x + w > width - 24) rows.push(row), (row = []), (x = 24);
      row.push({ ...it, x });
      x += w;
    }
    if (row.length) rows.push(row);
  }
  const titleH = spec.title ? 44 : 0;
  const legendH = rows.length ? rows.length * 38 + 22 : 0;
  const top = titleH + legendH + (legendH ? 18 : 0);
  const H = top + bodyH;
  const ox = pad - minX + (width - bodyW) / 2, oy = top + pad - minY;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r1(width)} ${r1(H)}" width="${r1(width)}" ` +
      `height="${r1(H)}" font-family="${FONT}">`,
  );
  if (spec.title) out.push(`<title>${esc(spec.title)}</title>`);
  out.push(`<style>${css(LIGHT)}${opts.png ? "" : `@media (prefers-color-scheme: dark) {${css(DARK)}}`}</style>`);
  out.push(`<rect class="bg" width="100%" height="100%"/>`);
  if (spec.title) {
    out.push(`<text x="24" y="32" font-size="20" font-weight="650" class="f-ink">${esc(spec.title)}</text>`);
  }
  if (rows.length) {
    out.push(`<rect class="card" x="8" y="${titleH + 8}" width="${r1(width - 16)}" height="${legendH - 8}" rx="10"/>`);
    rows.forEach((row, ri) => {
      const y = titleH + 8 + 26 + ri * 38;
      for (const it of row) {
        out.push(
          it.isLine
            ? strokeSvg(V, { kind: it.kind, pts: [[it.x, y], [it.x + 70, y]] })
            : glyphSvg(V, { kind: it.kind, x: it.x + 10, y }),
        );
        out.push(
          labelSvg({
            x: it.x + (it.isLine ? 82 : 30),
            y: y + 5,
            text: it.text,
            color: "ink",
            size: LABEL,
            anchor: "start",
          }, opts.png),
        );
      }
    });
  }
  out.push(`<rect class="card" x="8" y="${r1(top)}" width="${r1(width - 16)}" height="${r1(bodyH - 8)}" rx="12"/>`);
  out.push(`<g transform="translate(${r1(ox)} ${r1(oy)})">`);
  L.strokes.forEach((s) => out.push(strokeSvg(V, s)));
  L.arrows.forEach((a) => {
    const d = a.dir;
    out.push(
      `<path d="M${a.x - 5} ${a.y - 6 * d}L${a.x + 5} ${a.y - 6 * d}L${a.x} ${a.y + 2 * d}Z" ${fillAttr(a.color)}/>`,
    );
  });
  L.glyphs.forEach((g) => out.push(glyphSvg(V, g)));
  L.labels.forEach((l) => out.push(labelSvg(l, opts.png)));
  out.push(`</g>`);
  if (spec.time !== false) {
    out.push(
      labelSvg(
        { x: 30, y: H - 24, text: `${spec.time ?? "time"} →`, color: "gray", size: NOTE, anchor: "start" },
        opts.png,
      ),
    );
  }
  out.push(`</svg>`);
  return { svg: out.join("\n") + "\n", warnings: L.warnings };
}

// ---------- CLI ----------

/** One monospace face per OS that covers arrows and math symbols (Cascadia Mono and Consolas do not). */
function pngMono(): string {
  return Deno.build.os === "windows" ? "MS Gothic" : Deno.build.os === "darwin" ? "Menlo" : "DejaVu Sans Mono";
}

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
      font: { loadSystemFonts: true, serifFamily: pngMono(), monospaceFamily: pngMono() },
    })
      .render().asPng();
    await Deno.writeFile(pngPath, png);
    console.log(`wrote ${pngPath}`);
  }
}
