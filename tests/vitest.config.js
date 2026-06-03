import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    test: {
        root: path.resolve(import.meta.dirname, ".."),
        include: ["tests/**/*.test.js"],
        globals: false,
        environment: "node",
        setupFiles: ["tests/setup.js"]
    }
});
