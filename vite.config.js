import { defineConfig } from 'vite';

// Relative paths let the same build work at a domain root or a GitHub Pages
// project URL such as https://owner.github.io/lemon-city-g4-master/.
export default defineConfig({
  base: './',
});
