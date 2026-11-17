import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { render, type Spec, validate } from "./render.ts";

Deno.test("example renders without warnings", async () => {
  const url = new URL("../../../examples/inbox-triage.json", import.meta.url);
  const spec = JSON.parse(await Deno.readTextFile(url)) as Spec;
  const { svg, warnings } = render(spec);
  assertEquals(warnings, []);
  assert(svg.startsWith("<svg"));
  assert(svg.includes("Sam decides"));
  assert(!svg.includes("var(--"), "no CSS variables, so rasterizers agree with browsers");
});

Deno.test("validate catches bad refs, kinds, and duplicate ids", () => {
  const errs = validate({
    tracks: [
      { lane: 0, start: { label: "go" }, steps: [{ vertex: "branch", id: "a" }, { vertex: "branch", id: "a" }] },
      { lane: 1, from: "nope", steps: [{ line: "laser" as never }] },
    ],
  });
  assert(errs.some((e) => e.includes("duplicate vertex id")));
  assert(errs.some((e) => e.includes('no vertex has id "nope"')));
  assert(errs.some((e) => e.includes('unknown line kind "laser"')));
});

Deno.test("render throws on an invalid spec", () => {
  assertThrows(() => render({ tracks: [] }), Error, "non-empty");
});

Deno.test("legend lists only kinds in use", () => {
  const { svg } = render({
    tracks: [{ lane: 0, start: { label: "go" }, steps: [{ line: "code" }, { vertex: "stop" }] }],
  });
  assert(svg.includes("code decides"));
  assert(!svg.includes("the model decides"));
});
