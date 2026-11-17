# Spec format

A spec is one JSON object: a **vocabulary** (which line and vertex kinds exist and what they look like) plus **tracks**
(horizontal timelines). Steps along a track alternate between lines (stretches of time) and vertices (moments). The
renderer adds a short implicit line wherever two vertices touch.

```jsonc
{
  "title": "optional heading",
  "preset": "agent", // "agent" | "qed" | "none" (default): a starting vocabulary
  "lines": {/* name: LineDef */}, // added to, or overriding, the preset
  "vertices": {/* name: VertexDef */},
  "legend": { "human": "Sam decides" }, // override legend text per kind, or false to hide the legend
  "time": "time", // caption for the left-to-right axis, or false
  "lanePx": 115, // vertical distance between lanes
  "tracks": [/* Track */]
}
```

## Vocabulary

### LineDef

```jsonc
"air": { "stroke": "double", "color": "blue", "legend": "by air", "len": 200, "arrow": false }
```

| field    | values                                                                       | meaning                                     |
| -------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| `stroke` | `solid` `wave` `coil` `zigzag` `dashed` `dotted` `double`                    | the look                                    |
| `color`  | `ink` `gray` `blue` `orange` `red` `green` `purple` `teal` `pink`, or `#hex` | tokens adapt to dark mode; hex does not     |
| `arrow`  | boolean                                                                      | a direction chevron on each stretch         |
| `legend` | string                                                                       | what this kind means (defaults to its name) |
| `len`    | px                                                                           | default stretch length                      |

### VertexDef

```jsonc
"fee": { "shape": "diamond", "color": "red", "legend": "money changes hands", "labelColor": true, "bold": true }
```

| field        | values                                                                      | meaning                                  |
| ------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `shape`      | `circle` `diamond` `square` `triangle` `hexagon` `star` `cross` `dot` `bar` | the glyph                                |
| `fill`       | `solid` (default) or `hollow`                                               |                                          |
| `color`      | as for lines                                                                |                                          |
| `size`       | px (default 9)                                                              |                                          |
| `legend`     | string                                                                      | omit to keep this kind out of the legend |
| `labelColor` | boolean                                                                     | color the vertex's label to match        |
| `bold`       | boolean                                                                     | bold label                               |
| `labelPos`   | `below` (default) `above` `right` `above-left`                              |                                          |

### Built-in vertices (always available)

| kind       | glyph                                  | use                                                          |
| ---------- | -------------------------------------- | ------------------------------------------------------------ |
| `branch`   | small diamond in the color of its `by` | control splits; `by` = the line kind (or a color) that chose |
| `junction` | small dot                              | inputs merge here                                            |
| `stop`     | vertical bar                           | this path ends; its label and note sit to the right          |

### Presets

**`agent`**: who decides, and what each moment does to the world.

- Lines: `code` (solid), `model` (blue wave), `human` (orange dashed), `wait` (gray dotted).
- Vertices: `read` (hollow circle), `reversible` (black diamond), `irreversible` (red diamond), `gate` (hollow orange
  square: asks a human), `trust` (orange ring: temporary trust).

**`qed`**: particle physics.

- Lines: `fermion` (solid, arrow), `photon` (wave), `gluon` (coil), `boson` (zigzag: W/Z), `scalar` (dashed: Higgs).
- Vertices: `vertex` (dot), `blob` (gray disc: unresolved process).

## Track

| field     | type                                  | meaning                                                                                         |
| --------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `id`      | string                                | for warnings and your own reference                                                             |
| `lane`    | number                                | vertical position: `0` is the main path, negative is above, positive below. Fractions are fine. |
| `start`   | `{ label, note? }`                    | a trigger entering from the left edge                                                           |
| `from`    | vertex id                             | branch out of this vertex                                                                       |
| `offset`  | px                                    | for a free track (no `start`, no `from`): where it begins. It may open on a vertex.             |
| `merge`   | vertex id                             | end by flowing into this vertex; steps are stretched or squeezed to fit                         |
| `end`     | `{ label, note? }`                    | an outcome label after the track's last point (no stop bar)                                     |
| `line`    | line kind                             | for connectors, implicit lines, and stepless tracks (default: the first line kind)              |
| `label`   | string                                | bold, over the first stretch; colored by the `from` branch's `by`                               |
| `note`    | string \| string[]                    | gray lines under `label`                                                                        |
| `shape`   | `curve` (default) `square` `straight` | `square`: orthogonal corners (loops). `straight`: diagonal legs (physics).                      |
| `arrow`   | boolean                               | arrowhead into a square merge (default true)                                                    |
| `reverse` | boolean                               | flip direction chevrons (an antiparticle, a refund)                                             |
| `steps`   | Step[]                                | the timeline                                                                                    |

A trigger with no steps that merges (`start` + `merge`) is drawn as one sweep into its target.

## Steps

```jsonc
{ "line": "model", "label": "Classify", "note": ["what does this need?", "holds no tools"], "len": 220 }
{ "vertex": "irreversible", "id": "send", "label": "send reply", "note": "…", "labelPos": "below" }
{ "vertex": "branch", "id": "verdict", "by": "model" }
```

A line sizes itself to fit its label and note, clear of neighboring vertex labels. Set `len` to override. A line right
after a `branch` takes its label color from the branch's `by`.

`probe` hangs a side event off a line, such as a model that "may search this sender's mail":

```jsonc
"probe": { "vertex": "read", "label": "may search this", "note": "sender's mail", "line": "model", "height": 70, "side": "above", "at": 0.62 }
```

## Patterns

- **Several triggers, one pipeline:** the main track starts with the primary trigger, then a long line, then
  `{ "vertex": "junction", "id": "in" }`. Each other trigger is a `start` + `merge: "in"` track on lane ±1.4.
- **Someone picks a route:** `{ "vertex": "branch", "id": "v", "by": "<line kind or color>" }`, then one track per route
  with `from: "v"` on lanes 1.25, 2.25, …. The main path continues as the first route; label its next line.
- **Detour that rejoins:** a track with both `from` and `merge` (e.g. "duty owed" rejoining at the depot).
- **Approval loop:** a gate vertex, then a waiting line, then `branch` with `by` the approver's line kind. Add a loop
  track
  `{ "line": "<approver>", "from": "<gate>", "merge": "<branch>", "shape": "square", "lane": -2.2, "label": "…" }`.
- **Physics-style symmetric diagram:** a free main track
  `{ "lane": 0, "offset": 170, "steps": [vertex, line,
  vertex] }`, incoming legs
  `{ "start": …, "merge": "v1", "shape": "straight" }`, outgoing legs
  `{ "from": "v2",
  "shape": "straight", "end": { "label": "μ⁻" } }`.
- **Every path ends:** a `stop` (process paths) or an `end` label (physics, outcomes).

## Fonts

Labels use a sans stack whose fallback is monospace, never serif. Symbol runs (arrows, math operators, shapes) are set
in monospace explicitly. In the PNG, resvg switches a whole text element to its fallback face, so a label that contains
such a symbol renders entirely in monospace.
