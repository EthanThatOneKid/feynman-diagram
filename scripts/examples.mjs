// Re-render every example (SVG + PNG).
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

for (const f of readdirSync("examples").filter((f) => f.endsWith(".json"))) {
  const name = f.replace(/\.json$/, "");
  execFileSync(
    process.execPath,
    ["skills/feynman-diagram/scripts/render.ts", `examples/${f}`, "--png", `examples/${name}.png`],
    { stdio: "inherit" },
  );
}
