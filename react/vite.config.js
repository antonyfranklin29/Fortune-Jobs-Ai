import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom' },
  root: resolve(import.meta.dirname),
  base: './',
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        find: resolve(import.meta.dirname, 'find-jobs.html'),
        results: resolve(import.meta.dirname, 'results.html'),
        login: resolve(import.meta.dirname, 'login.html'),
        employerLogin: resolve(import.meta.dirname, 'employer-login.html'),
        profile: resolve(import.meta.dirname, 'profile.html'),
        employers: resolve(import.meta.dirname, 'employers.html'),
        resumeSearch: resolve(import.meta.dirname, 'resume-search.html'),
        resumeBuilder: resolve(import.meta.dirname, 'resume-builder.html')
      }
    }
  }
});
