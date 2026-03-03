import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['http://127.0.0.1:3000'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:5001/api/:path*',
      },
    ]
  },
}

export default nextConfig
