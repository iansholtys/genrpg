// Pairs are computed once at startup; restart after adding package component SCSS.
import { discoverPackageScssPairs } from "./sass-dirs.mjs";
import { runSassWatch } from "./sass-run.mjs";

runSassWatch(discoverPackageScssPairs(), {
  emptyMessage:
    "No package SCSS entry files found under genrpg/public or installed package public trees.",
});
