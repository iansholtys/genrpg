// Pairs are computed once at startup; restart this process after adding new entry SCSS.
import { discoverShellScssPairs } from "./sass-dirs.mjs";
import { runSassWatch } from "./sass-run.mjs";

runSassWatch(discoverShellScssPairs(), {
  emptyMessage: "No shell SCSS entry files found under public/scss.",
});
