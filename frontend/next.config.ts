import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '4000' },
      { protocol: 'http', hostname: '**', port: '4000' },
      { protocol: 'http', hostname: '**', port: '' },
    ],
  },
};

export default nextConfig;
