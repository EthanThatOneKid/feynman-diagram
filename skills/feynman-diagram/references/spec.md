# Spec format

A spec is one JSON object. Tracks are horizontal timelines. Steps along a track alternate between **lines** (stretches
of time) and **vertices** (moments). The renderer adds a short implicit line wherever two vertices touch.

```jsonc
{
  "title": "optional heading",
  "legend": { "human": "Sam decides" }, // override legend text per kind, or false to hide the legend
  "time": "time", // bottom-left axis caption, or false
  "lanePx": 115, // vertical distance between lanes
  "tracks": [/* Track */]
}
```

## Track

| field   | type                    | meaning                                                                                            |
| ------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `id`    | string                  | for warnings and your own reference                                                                |
| `lane`  | number                  | vertical position. `0` is the main path, negative is above it, positive below. Fractions are fine. |
| `start` | `{ label, note? }`      | a trigger entering from the left edge (bold label, gray note). Needs `start` or `from`.            |
| `from`  | vertex id               | the track branches out of this vertex                                                              |
| `merge` | vertex id               | the track ends by flowing into this vertex. Its steps are stretched or squeezed to fit.            |
| `line`  | line kind               | stroke for connectors, implicit lines, and stepless tracks (default `code`)                        |
| `label` | string                  | bold label over the track's first stretch. Its color is the decider of the `from` branch.          |
| `note`  | string \| string[]      | gray lines under `label`                                                                           |
| `shape` | `"curve"` \| `"square"` | `square` draws orthogonal corners. Use it for human loops from a gate to its answer.               |
| `arrow` | boolean                 | arrowhead into a square merge (default true)                                                       |
| `steps` | Step[]                  | the timeline                                                                                       |

A trigger with no steps that merges (`start` + `merge`) is drawn as one sweeping curve into its target.

## Line step

```jsonc
{ "line": "model", "label": "Classify", "note": ["what does this need?", "holds no tools"], "len": 220 }
```

| kind    | stroke        | meaning                                   |
| ------- | ------------- | ----------------------------------------- |
| `code`  | solid black   | deterministic code decides                |
| `model` | blue wave     | an LLM decides                            |
| `human` | orange dashed | a person decides                          |
| `wait`  | gray dotted   | asleep, waiting: nothing runs, no process |

The renderer sizes `len` to fit its label and note, clear of the neighboring vertices' labels. Set `len` to override. A
line that follows a `branch` vertex takes its label color from the branch's decider.

`probe` hangs an optional side read off the line, like a model that "may search this sender's mail":

```jsonc
"probe": { "label": "may search this", "note": "sender's mail", "vertex": "read", "line": "model", "height": 70, "side": "above", "at": 0.62 }
```

## Vertex step

```jsonc
{ "vertex": "irreversible", "id": "send", "label": "send reply", "note": "…", "labelPos": "below" }
```

| kind           | glyph                     | meaning                                  |
| -------------- | ------------------------- | ---------------------------------------- |
| `read`         | hollow circle             | reads the world                          |
| `reversible`   | black diamond             | changes the world, can be undone         |
| `irreversible` | red diamond, red label    | changes the world, cannot be undone      |
| `trust`        | orange ring               | grants temporary trust                   |
| `gate`         | hollow orange square      | asks a human, then usually waits         |
| `branch`       | small diamond, `by` color | control splits; `by`: code, model, human |
| `junction`     | small dot                 | triggers merge here                      |
| `stop`         | vertical bar              | this path ends; its label/note sit right |

`labelPos` is one of `below` (the default), `above`, `right` (the default for `stop`), or `above-left` (the default for
`gate`). Give a vertex an `id` when a track branches `from` it or `merge`s into it. Ids must be unique.

## Patterns

- **Several triggers, one pipeline:** main track starts with the primary trigger, then a long `code` line, then
  `{ "vertex": "junction", "id": "in" }`. Each other trigger is a `start` + `merge: "in"` track on lane ±1.4.
- **Model picks a route:** `{ "vertex": "branch", "id": "verdict", "by": "model" }` on the main path. Then one track per
  route with `from: "verdict"` on lanes 1.25, 2.25, 3.25, … The main path continues as the first route (label its next
  line).
- **Human approval:** `gate` → `wait` line → `{ "vertex": "branch", "id": "answer", "by": "human" }`, plus a loop track
  `{ "lane": -2.2, "line": "human", "from": "<gate id>", "merge": "answer", "shape": "square", "label": "…" }`.
- **Every path stops.** End each leaf track with `{ "vertex": "stop" }`. A stop's `note` explains what is left behind.
