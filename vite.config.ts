import { defineConfig } from "vite-plus";

export default defineConfig({
  base: "/2048-Solver/",
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
});
