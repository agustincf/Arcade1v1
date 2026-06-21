/** @type {import('next').NextConfig} */
const nextConfig = {
  // El motor compartido (game-sdk) viene en TypeScript: Next lo transpila.
  transpilePackages: ["@arcade1v1/game-sdk"],
};

export default nextConfig;
