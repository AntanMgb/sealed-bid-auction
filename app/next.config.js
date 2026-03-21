/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.resolve.fallback = { fs: false, path: false, os: false };
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/api/tee/:path*",
        destination: "https://tee.magicblock.app/:path*",
      },
      {
        source: "/api/tee",
        destination: "https://tee.magicblock.app",
      },
    ];
  },
};

module.exports = nextConfig;
