import { defineConfig } from "vite-plus";

export default defineConfig({
  base: "/2048-Solver/",
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        privacy: "privacy.html",
      },
    },
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
});
