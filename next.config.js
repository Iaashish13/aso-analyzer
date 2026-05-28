/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      'google-play-scraper',
      'app-store-scraper',
      'natural',
    ],
  },
};

module.exports = nextConfig;
