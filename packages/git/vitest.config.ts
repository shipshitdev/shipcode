import { definePackageVitestConfig } from '../../vitest.package-config';

export default definePackageVitestConfig({
  environment: 'node',
  exclude: ['dist/**'],
});
