---
name: feynman-diagram
description: >-
  Diagram a concept, architecture, agent, workflow, or pipeline as a Feynman-style timeline: time runs left to right,
  each line's stroke says who decides that stretch (code, the model, a human, or nobody while it waits), and each
  vertex says what that moment does to the world (reads it, changes it reversibly, changes it irreversibly, grants
  trust, stops). Use when asked for /feynman-diagram, a "Feynman diagram" of a system, an agent control-flow or
  authority diagram, a who-decides-what map, or a picture of where a system can do irreversible things. Writes a JSON
  spec and renders it to SVG (and PNG) with a bundled Deno script.
---

# /feynman-diagram

Draw a system the way Feynman drew particle interactions: **time runs left to right, lines carry control, vertices are
where something happens.** The diagram answers three questions at a glance:

1. **Who decides** each stretch of time? Code (solid), the model (wave), a human (dashed), or nobody: asleep, waiting
   (dotted).
2. **What does each moment do to the world?** Reads it (hollow circle), changes it reversibly (black diamond), changes
   it irreversibly (red diamond), grants temporary trust (orange ring), asks a human (orange square), stops (bar).
3. **Where does control split, rejoin, and end?** Branches fan out from a small diamond colored by whoever chose the
   branch. Triggers sweep in from the left and merge. Every path ends in a stop bar.

You do the semantics; `scripts/render.ts` does the geometry. You never place pixels by hand.

## Workflow

1. **Understand the system.** Read the code, docs, or description you were given. When the subject is a codebase, trace
   the real control flow: entry points, scheduler/cron triggers, LLM calls, tool calls, approval steps, writes, and
   exits. Do not invent steps. Mark guesses as guesses in a note.

2. **Inventory before drawing.** Write a short table, either in your scratchpad or to the user:

   | Moment | Who decides the stretch before it | Effect on the world | Branches? |
   | ------ | --------------------------------- | ------------------- | --------- |

   Classify honestly. These rules matter most:
   - A **model** line means an LLM is choosing. Code that merely _calls_ a model and uses its output deterministically
     is still a model stretch for the duration of the call, followed by code.
   - **Reversible vs. irreversible** is about the real world, not the codebase. Saving a draft, adding a label, or
     writing a row you can delete is reversible. Sending email, paying money, posting publicly, deleting without a
     backup, or calling an external API with side effects is irreversible. When unsure, use red and say why in a note.
   - A **human** line is a stretch where a person chooses. A **gate** is the moment the system asks; the wait that
     follows is dotted (it holds no process); the answer is a branch `by: "human"`.
   - **Trust** is a grant that lets the system skip a future human decision (for example, "trust this sender 24 h").
   - A **read** that the model may optionally do mid-stretch is a `probe` on that model line.

3. **Write the spec** as `<name>.feynman.json`, next to the subject or wherever the user asked. The format is in
   [references/spec.md](references/spec.md), and a full worked example is in
   [`examples/inbox-triage.json`](../../examples/inbox-triage.json) at the repo root. Shape:
   - one `lane: 0` track for the main path, started by its primary trigger;
   - extra triggers as tracks with `start` + `merge` into a `junction` on the main path (negative lanes above, positive
     below);
   - each branch as a track with `from: <branch vertex id>`, fanned out across lanes;
   - human loops (gate → answer) as `shape: "square"` tracks with `line: "human"`.

4. **Render** (Deno required):

   ```sh
   deno run --allow-read --allow-write --allow-env --allow-ffi --allow-sys --allow-net \
     <skill-dir>/scripts/render.ts diagram.feynman.json -o diagram.svg --png diagram.png
   ```

   Drop `--png` (and every permission flag past `--allow-write`) if you only need the SVG. `<skill-dir>` is the
   directory holding this file.

5. **Look at the PNG** (read the image) and fix what you see. Common fixes:
   - labels collide → raise `len` on the line between them, or move a vertex label with `labelPos` (`above` | `below` |
     `right` | `above-left`);
   - branches crowd → spread their `lane` values further apart (fractional lanes are fine);
   - a renderer warning says a merge track has no room → lengthen the main-path line before the merge target.

   Iterate until nothing overlaps and every path ends. Then hand the user the SVG (and the spec, so they can edit it).

## Style rules

- **Labels are verbs or verdicts, lowercase, short:** `read thread`, `save draft`, `send reply`. Branch labels are the
  verdict that chose them: `noise`, `needs reply`, `leave it`. Stretch labels on model lines are capitalized task names:
  `Classify`, `Draft`.
- **Notes carry the "why" and the limits** in gray: `holds no tools`, `if busy: restart`, `nothing sent · draft stays`.
  Use `·` to join short clauses.
- Name the human in the legend when there is one: `"legend": { "human": "Sam decides" }`.
- One diagram per system. If it needs more than about 8 lanes or 40 vertices, split it into an overview plus close-ups.
- The legend only lists kinds the diagram uses. Set `"legend": false` to omit it.

## Provenance

The visual grammar follows a hand-drawn agent diagram of an inbox-triage assistant (recreated in `examples/`). The split
between Substance and Style, where the agent writes semantics and a renderer owns layout, follows Wen et al., "Feynman:
Knowledge-Infused Diagramming Agent for Scalable Visual Designs" (arXiv:2603.12597).
