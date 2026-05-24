import { defineConfig } from 'deepsec/config';

export default defineConfig({
  projects: [
    { id: 'shipcode', root: '..' },
    // <deepsec:projects-insert-above>
  ],
});
