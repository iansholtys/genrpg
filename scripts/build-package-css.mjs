import { discoverPackageScssPairs } from "./sass-dirs.mjs";
import { runSassBuild } from "./sass-run.mjs";

runSassBuild(discoverPackageScssPairs(), {
  emptyMessage:
    "No package SCSS entry files found under genrpg/public or installed package public trees.",
});
