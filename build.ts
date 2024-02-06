import { build, emptyDir } from "https://deno.land/x/dnt@0.40.0/mod.ts";

await emptyDir("./npm");

await build({
  entryPoints: ["./mod.ts"],
  outDir: "./npm",
  package: {
    name: "accumulating-processor",
    version: Deno.args[0],
    description:
      "batch processor that accumulates items by count, delay, or size",
    keywords: [
      "accumulating",
      "batch",
      "processor",
    ],
    homepage: "https://github.com/dstelljes/accumulating-processor#readme",
    bugs: "https://github.com/dstelljes/accumulating-processor/issues",
    repository: "github:dstelljes/accumulating-processor",
    license: "MIT",
    contributors: [
      {
        name: "Dan Stelljes",
        email: "dan@stellj.es",
        url: "https://stellj.es",
      },
    ],
  },
  async postBuild() {
    await Deno.copyFile("LICENSE.md", "npm/LICENSE.md");
    await Deno.copyFile("README.md", "npm/README.md");
  },
  shims: {
    deno: {
      test: "dev",
    },
  },
  typeCheck: false, // todo: bunch of std errors, no idea how to fix
});
