import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { render, type Spec, validate } from "./render.ts";

const examples = ["inbox-triage", "pr-review-bot", "qed-annihilation", "package-shipment"];

for (const name of examples) {
  Deno.test(`example ${name} renders without warnings`, async () => {
    const url = new URL(`../../../examples/${name}.json`, import.meta.url);
    const spec = JSON.parse(await Deno.readTextFile(url)) as Spec;
    const { svg, warnings } = render(spec);
    assertEquals(warnings, []);
    assert(svg.startsWith("<svg"));
    assert(!svg.includes("var(--"), "no CSS variables, so rasterizers agree with browsers");
  });
}

Deno.test("custom vocabulary drives strokes, glyphs, and legend", () => {
  const { svg } = render({
    lines: { court: { stroke: "zigzag", color: "purple", legend: "the court decides" } },
    vertices: { ruling: { shape: "star", color: "red", legend: "binding ruling" } },
    tracks: [{
      lane: 0,
      start: { label: "filing" },
      steps: [{ line: "court" }, { vertex: "ruling" }, { vertex: "stop" }],
    }],
  });
  assert(svg.includes("the court decides"));
  assert(svg.includes("binding ruling"));
  assert(svg.includes("k-purple"));
  assert(!svg.includes("code decides"), "no agent vocabulary leaks into a custom diagram");
});

Deno.test("validate names the known kinds when a kind is unknown", () => {
  const errs = validate({
    preset: "agent",
    tracks: [
      { lane: 0, start: { label: "go" }, steps: [{ vertex: "branch", id: "a" }, { vertex: "branch", id: "a" }] },
      { lane: 1, from: "nope", steps: [{ line: "laser" }, { vertex: "teleport" }] },
    ],
  });
  assert(errs.some((e) => e.includes("duplicate vertex id")));
  assert(errs.some((e) => e.includes('no vertex has id "nope"')));
  assert(errs.some((e) => e.includes('unknown line kind "laser"') && e.includes("code, model, human, wait")));
  assert(errs.some((e) => e.includes('unknown vertex kind "teleport"')));
});

Deno.test("a spec without any line kinds is rejected", () => {
  assert(validate({ tracks: [{ lane: 0, start: { label: "go" } }] }).some((e) => e.includes("no line kinds")));
});

Deno.test("bad vocabulary values are rejected", () => {
  const errs = validate({
    lines: { x: { stroke: "sparkly" as never, color: "chartreuse" as never } },
    vertices: { y: { shape: "blob" as never } },
    tracks: [{ lane: 0, start: { label: "go" } }],
  });
  assert(errs.some((e) => e.startsWith("lines.x: stroke")));
  assert(errs.some((e) => e.startsWith("lines.x: color")));
  assert(errs.some((e) => e.startsWith("vertices.y: shape")));
});

Deno.test("render throws on an invalid spec", () => {
  assertThrows(() => render({ tracks: [] }), Error, "non-empty");
});

Deno.test("legend lists only kinds in use", () => {
  const { svg } = render({
    preset: "agent",
    tracks: [{ lane: 0, start: { label: "go" }, steps: [{ line: "code" }, { vertex: "stop" }] }],
  });
  assert(svg.includes("code decides"));
  assert(!svg.includes("the model decides"));
});

Deno.test("symbol runs are set in monospace", () => {
  const spec: Spec = { preset: "agent", tracks: [{ lane: 0, start: { label: "a ⇒ b" }, steps: [{ line: "code" }] }] };
  assert(/<tspan font-family="[^"]*monospace">⇒<\/tspan>/.test(render(spec).svg));
  assert(/<text[^>]*font-family="[^"]+">a ⇒ b</.test(render(spec, { png: true }).svg));
});

Deno.test("wide diagrams warn unless maxWidth allows them", () => {
  const steps = Array.from({ length: 16 }, () => ({ line: "code" as const, len: 120 }));
  const spec: Spec = { preset: "agent", tracks: [{ lane: 0, start: { label: "go" }, steps }] };
  assert(render(spec).warnings.some((w) => w.includes("wide")));
  assertEquals(render({ ...spec, maxWidth: 0 }).warnings, []);
});

Deno.test("a trigger label never overlaps the first stretch's own label", () => {
  const { svg } = render({
    preset: "agent",
    tracks: [{ lane: 0, start: { label: "agent needs a fact" }, steps: [{ line: "model", label: "Recall" }] }],
  });
  const x = (text: string) => Number(svg.match(new RegExp(`<text x="([\\d.]+)"[^>]*>${text}<`))![1]);
  const startRight = x("agent needs a fact") + "agent needs a fact".length * 15 * 0.6;
  const recallLeft = x("Recall") - ("Recall".length * 15 * 0.6) / 2;
  assert(recallLeft > startRight, `Recall starts at ${recallLeft}, trigger label ends at ${startRight}`);
});
