import { discoverShellScssPairs } from "./sass-dirs.mjs";
import { runSassBuild } from "./sass-run.mjs";

runSassBuild(discoverShellScssPairs(), {
  emptyMessage: "No shell SCSS entry files found under public/scss.",
});
