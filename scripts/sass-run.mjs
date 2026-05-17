import { execSync, spawn } from "child_process";
import { repoRoot } from "./sass-dirs.mjs";

export function runSassBuild(pairs, { cwd = repoRoot, emptyMessage } = {}) {
  if (pairs.length === 0) {
    console.log(emptyMessage || "No SCSS entry files found.");
    process.exit(0);
  }

  execSync(`npx sass --style=expanded --no-source-map ${pairs.join(" ")}`, {
    cwd,
    stdio: "inherit",
    shell: true,
  });
}

export function runSassWatch(pairs, { cwd = repoRoot, emptyMessage } = {}) {
  if (pairs.length === 0) {
    console.log(emptyMessage || "No SCSS entry files found.");
    process.exit(0);
  }

  const child = spawn(
    "npx",
    ["sass", "--watch", "--style=expanded", "--no-source-map", ...pairs],
    { cwd, stdio: "inherit", shell: true },
  );

  process.on("SIGINT", () => {
    child.kill("SIGINT");
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
