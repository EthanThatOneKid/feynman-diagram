---
name: feynman-diagram
description: >-
  Diagram any process, concept, architecture, or system in any domain as a Feynman-style diagram: time runs left to
  right, a line's stroke says what kind of thing carries the process through that stretch, and a vertex's glyph says
  what kind of event happens at that moment. Each diagram defines its own vocabulary of line and vertex kinds, or uses
  a preset (`agent` for software agents, meaning who decides and what changes the world; `qed` for particle
  physics). Use for /feynman-diagram, "Feynman diagram of X", a timeline or flow diagram where *who or what* carries
  each step and *what each event does* both matter: agent and software workflows, particle interactions, logistics,
  legal or business processes, biology pathways, game turns, protocols. Writes a JSON spec and renders it to SVG and
  PNG with a bundled script that runs on Bun or Node.
---

# /feynman-diagram

Draw a process the way Feynman drew particle interactions: **time runs left to right, lines carry the process, vertices
are where something happens.** What lines and vertices _mean_ depends on the domain, and you choose it.

The method is the same for every domain:

| Feynman                     | In your diagram                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------- |
| particle type → line style  | **what carries this stretch**: who is in control, what medium, what state          |
| interaction → vertex        | **what kind of event happens**: its effect, its cost, whether it can be reversed   |
| lines splitting and joining | branches (someone or something chooses a route), merges (inputs combine)           |
| external lines              | triggers entering from the left; outcomes leaving on the right or ending at a stop |

You do the semantics; `scripts/render.ts` does the geometry. You never place pixels by hand.

## Workflow

1. **Understand the subject.** Read the code, docs, or description. Trace what really happens, in time order: what
   starts it, what moves it forward, where it splits, what it touches, how each path ends. Do not invent steps. Mark
   guesses as guesses in a note.

2. **Choose the vocabulary.** This is the step that matters most. Pick the two questions this diagram answers:
   - **Lines answer "what carries this stretch?"** Pick 2–5 kinds that are mutually exclusive and cover every stretch.
     Examples: code / model / human / waiting (an agent); fermion / photon / gluon (QED); road / air / held / courier
     (shipping); plaintiff / court / defendant / stayed (litigation); cytosol / membrane / nucleus (signaling).
   - **Vertices answer "what kind of moment is this?"** Pick 2–6 kinds, chosen for the distinction a reader most needs.
     Examples: reads / changes reversibly / changes irreversibly (an agent); interaction (QED); scanned / changes hands
     / money changes hands (shipping); filing / ruling / settlement (litigation).
   - Give **red** to the moment that most deserves attention (irreversible, costly, dangerous) and **gray dotted** to
     stretches where nothing moves. Keep everything else ink unless color separates something real.
   - If a preset fits, use it: `"preset": "agent"` for software agents and automations, `"preset": "qed"` for particle
     physics. Override or extend a preset's kinds in `lines` / `vertices`.

   Write the vocabulary down as a two-column table (kind → meaning) before you write the spec. If a stretch or moment
   fits no kind, or fits two, revise the vocabulary first.

3. **Inventory.** List each moment in time order with its vertex kind, the line kind of the stretch before it, and
   whether it branches. This becomes the spec almost line for line.

4. **Write the spec** as `<name>.feynman.json`, next to the subject or wherever the user asked. The format is in
   [references/spec.md](references/spec.md). Shape:
   - one `lane: 0` track for the main path, opened by its primary trigger (`start`);
   - extra triggers as `start` + `merge` tracks into a `junction` (negative lanes above, positive below);
   - each route out of a `branch` as a track with `from: <branch id>`, fanned across lanes;
   - loops that return (an approval, a retry) as `shape: "square"` tracks with `from` + `merge`;
   - symmetric, physics-style diagrams as free tracks (`offset`, no `start`) plus `shape: "straight"` legs.

5. **Render** (Bun, or Node 22.18+; both run the TypeScript directly):

   ```sh
   cd <skill-dir> && npm install   # once, only needed for --png (Bun installs it on demand)
   bun <skill-dir>/scripts/render.ts diagram.feynman.json -o diagram.svg --png diagram.png
   # or: node <skill-dir>/scripts/render.ts diagram.feynman.json -o diagram.svg --png diagram.png
   ```

   Drop `--png` for SVG only; that needs no install. `<skill-dir>` is the directory holding this file. The renderer
   validates the spec and lists the kinds it knows when you name an unknown one.

6. **Look at the PNG** (read the image) and fix what you see:
   - labels collide → raise `len` on the line between them, or move a vertex label with `labelPos`;
   - branches crowd → spread their `lane` values (fractions are fine);
   - a warning says a merge has no room → lengthen the main-path line before the merge target.
   - a warning says the diagram is too wide (over 1400px; a README shows images at ~900px) → split it into an overview
     and close-ups (e.g. a write path and a read path), shorten notes and labels, or tighten `len`. Set `"maxWidth": 0`
     only when the image will be shown full size.

   Iterate until nothing overlaps and every path ends or exits. Hand the user the SVG and the spec.

## Style rules

- **Labels are short and lowercase**: verbs for moments (`pickup`, `send reply`), verdicts for routes (`cleared`,
  `nobody home`). Capitalize a stretch label only when it names a task (`Classify`, `Flight`).
- **Notes carry the why and the limits** in gray: `holds no tools`, `customs queue · 1–3 days`.
- **Legend text states the meaning, not the look**: "money changes hands", not "red diamond".
- One diagram per process. Past about 8 lanes or 40 vertices, split it into an overview and close-ups.
- The legend lists only kinds the diagram uses. Set `"legend": false` to hide it.

## Examples

`examples/` at the repo root: `inbox-triage` and `pr-review-bot` (preset `agent`), `qed-annihilation` (preset `qed`),
and `package-shipment` (custom vocabulary). Each has its `.json` spec and rendered `.svg` / `.png`.

## Provenance

The `agent` preset follows a hand-drawn diagram of an inbox-triage assistant by Sam Collins
([@smcllns](https://x.com/smcllns/status/2122390025816207504)), recreated in `examples/`. The split between Substance
and Style, where the agent writes semantics and a renderer owns layout, follows Wen et al., "Feynman: Knowledge-Infused
Diagramming Agent for Scalable Visual Designs" (arXiv:2603.12597).
