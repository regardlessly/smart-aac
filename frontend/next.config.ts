import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['http://192.168.88.*', 'http://192.168.88.*:3000', '192.168.88.*', '192.168.88.*:3000'],
  async redirects() {
    return [
      {
        source: '/seniors',
        destination: '/members',
        permanent: true,
      },
    ]
  },
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
