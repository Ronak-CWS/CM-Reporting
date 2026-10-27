import type { NextConfig } from 'next';
import { basePath } from './lib/app-path.js';

const nextConfig: NextConfig = {
  basePath: basePath(),
  // IIS owns the application-directory redirect in production. Local dev uses Next's redirects.
  skipTrailingSlashRedirect: process.env.NODE_ENV === 'production',
  poweredByHeader: false,
  devIndicators: false,
  experimental: { proxyClientMaxBodySize: '32mb' },
};

export default nextConfig;
