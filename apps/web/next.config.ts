import type { NextConfig } from 'next';

// No `output: 'export'`: the site is a Next.js server build so app/download can
// run as a serverless Function (reads request headers, hits the GitHub API,
// 307s to the latest release DMG). Every other route stays statically prerendered.
const config: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
};

export default config;
