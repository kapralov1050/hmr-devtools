import {defineConfig} from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
    },
    format: ['esm'],
    target: 'node18',
    outDir: 'dist',
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    splitting: false,
    // Vite is a peer dep - must not bundle it
    external: ['vite'],
});
