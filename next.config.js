/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      'google-play-scraper',
      'app-store-scraper',
      'natural',
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'play-lh.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '**.mzstatic.com',
      },
    ],
  },
};

module.exports = nextConfig;
