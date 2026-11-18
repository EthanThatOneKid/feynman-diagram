import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { render, type Spec, validate } from "./render.ts";

const examples = ["inbox-triage", "pr-review-bot", "qed-annihilation", "package-shipment"];

for (const name of examples) {
  test(`example ${name} renders without warnings`, () => {
    const url = new URL(`../../../examples/${name}.json`, import.meta.url);
    const spec = JSON.parse(readFileSync(url, "utf8")) as Spec;
    const { svg, warnings } = render(spec);
    assert.deepEqual(warnings, []);
    assert.ok(svg.startsWith("<svg"));
    assert.ok(!svg.includes("var(--"), "no CSS variables, so rasterizers agree with browsers");
  });
}

test("custom vocabulary drives strokes, glyphs, and legend", () => {
  const { svg } = render({
    lines: { court: { stroke: "zigzag", color: "purple", legend: "the court decides" } },
    vertices: { ruling: { shape: "star", color: "red", legend: "binding ruling" } },
    tracks: [
      {
        lane: 0,
        start: { label: "filing" },
        steps: [{ line: "court" }, { vertex: "ruling" }, { vertex: "stop" }],
      },
    ],
  });
  assert.ok(svg.includes("the court decides"));
  assert.ok(svg.includes("binding ruling"));
  assert.ok(svg.includes("k-purple"));
  assert.ok(!svg.includes("code decides"), "no agent vocabulary leaks into a custom diagram");
});

test("validate names the known kinds when a kind is unknown", () => {
  const errs = validate({
    preset: "agent",
    tracks: [
      {
        lane: 0,
        start: { label: "go" },
        steps: [
          { vertex: "branch", id: "a" },
          { vertex: "branch", id: "a" },
        ],
      },
      { lane: 1, from: "nope", steps: [{ line: "laser" }, { vertex: "teleport" }] },
    ],
  });
  assert.ok(errs.some((e) => e.includes("duplicate vertex id")));
  assert.ok(errs.some((e) => e.includes('no vertex has id "nope"')));
  assert.ok(errs.some((e) => e.includes('unknown line kind "laser"') && e.includes("code, model, human, wait")));
  assert.ok(errs.some((e) => e.includes('unknown vertex kind "teleport"')));
});

test("a spec without any line kinds is rejected", () => {
  assert.ok(validate({ tracks: [{ lane: 0, start: { label: "go" } }] }).some((e) => e.includes("no line kinds")));
});

test("bad vocabulary values are rejected", () => {
  const errs = validate({
    lines: { x: { stroke: "sparkly" as never, color: "chartreuse" as never } },
    vertices: { y: { shape: "blob" as never } },
    tracks: [{ lane: 0, start: { label: "go" } }],
  });
  assert.ok(errs.some((e) => e.startsWith("lines.x: stroke")));
  assert.ok(errs.some((e) => e.startsWith("lines.x: color")));
  assert.ok(errs.some((e) => e.startsWith("vertices.y: shape")));
});

test("render throws on an invalid spec", () => {
  assert.throws(() => render({ tracks: [] }), /non-empty/);
});

test("legend lists only kinds in use", () => {
  const { svg } = render({
    preset: "agent",
    tracks: [{ lane: 0, start: { label: "go" }, steps: [{ line: "code" }, { vertex: "stop" }] }],
  });
  assert.ok(svg.includes("code decides"));
  assert.ok(!svg.includes("the model decides"));
});

test("symbol runs are set in monospace", () => {
  const spec: Spec = { preset: "agent", tracks: [{ lane: 0, start: { label: "a ⇒ b" }, steps: [{ line: "code" }] }] };
  assert.ok(/<tspan font-family="[^"]*monospace">⇒<\/tspan>/.test(render(spec).svg));
  assert.ok(/<text[^>]*font-family="[^"]+">a ⇒ b</.test(render(spec, { png: true }).svg));
});

test("wide diagrams warn unless maxWidth allows them", () => {
  const steps = Array.from({ length: 16 }, () => ({ line: "code" as const, len: 120 }));
  const spec: Spec = { preset: "agent", tracks: [{ lane: 0, start: { label: "go" }, steps }] };
  assert.ok(render(spec).warnings.some((w) => w.includes("wide")));
  assert.deepEqual(render({ ...spec, maxWidth: 0 }).warnings, []);
});

test("a trigger label never overlaps the first stretch's own label", () => {
  const { svg } = render({
    preset: "agent",
    tracks: [{ lane: 0, start: { label: "agent needs a fact" }, steps: [{ line: "model", label: "Recall" }] }],
  });
  const x = (text: string) => Number(svg.match(new RegExp(`<text x="([\\d.]+)"[^>]*>${text}<`))![1]);
  const startRight = x("agent needs a fact") + "agent needs a fact".length * 15 * 0.6;
  const recallLeft = x("Recall") - ("Recall".length * 15 * 0.6) / 2;
  assert.ok(recallLeft > startRight, `Recall starts at ${recallLeft}, trigger label ends at ${startRight}`);
});
