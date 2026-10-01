import type { NextConfig } from 'next';
import { basePath } from './lib/app-path.js';

const nextConfig: NextConfig = {
  basePath: basePath(),
  // IIS owns the /cm-reporting/ application-directory redirect. Do not redirect it back to /cm-reporting.
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  devIndicators: false,
  experimental: { proxyClientMaxBodySize: '32mb' },
};

export default nextConfig;
