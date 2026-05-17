import { existsSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export const repoRoot = join(__dirname, "..");

const SKIP_DIRS = new Set(["node_modules", ".git"]);

function toPosixPath(fromRoot, absolutePath) {
  return relative(fromRoot, absolutePath).split("\\").join("/");
}

function collectScssPairsInTree(dir, root, pairs) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;

    const fullPath = join(dir, name);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      collectScssPairsInTree(fullPath, root, pairs);
      continue;
    }

    if (!name.endsWith(".scss") || name.startsWith("_")) {
      continue;
    }

    const relScss = toPosixPath(root, fullPath);
    const relCss = relScss.replace(/\.scss$/i, ".css");
    pairs.push(`${relScss}:${relCss}`);
  }
}

// GenRPG shell: public/scss/styles.scss and variable partials to public/css/.
export function discoverAppScssPairs(root = repoRoot) {
  const pairs = [];
  const scssDir = join(root, "public", "scss");

  const mainEntry = join(scssDir, "styles.scss");
  if (existsSync(mainEntry)) {
    pairs.push("public/scss/styles.scss:public/css/styles.css");
  }

  if (!existsSync(scssDir)) {
    return pairs;
  }

  for (const name of readdirSync(scssDir)) {
    if (!name.startsWith("_") || !name.endsWith("-vars.scss")) {
      continue;
    }

    const outName = name.slice(1).replace(/\.scss$/i, ".css");
    pairs.push(`public/scss/${name}:public/css/${outName}`);
  }

  return pairs;
}

// GenRPG app shell only (not public/components/reusable — that submodule builds its own CSS).
export function discoverShellScssPairs(root = repoRoot) {
  return discoverAppScssPairs(root);
}

// Installed packages: genrpg/public and packages/<name>/public (same-dir CSS output).
export function discoverPackageScssPairs(root = repoRoot) {
  const pairs = [];
  const publicRoots = [join(root, "genrpg", "public")];

  const packagesDir = join(root, "packages");
  if (existsSync(packagesDir)) {
    for (const name of readdirSync(packagesDir)) {
      if (name.startsWith(".") || name === ".git") continue;

      const publicDir = join(packagesDir, name, "public");
      if (existsSync(publicDir) && statSync(publicDir).isDirectory()) {
        publicRoots.push(publicDir);
      }
    }
  }

  for (const publicRoot of publicRoots) {
    if (!existsSync(publicRoot)) continue;
    collectScssPairsInTree(publicRoot, root, pairs);
  }

  return pairs;
}
