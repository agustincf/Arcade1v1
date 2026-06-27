/** @type {import('next').NextConfig} */
const nextConfig = {
  // El motor compartido (game-sdk) y el cliente del arbitro (agent-sdk)
  // vienen en TypeScript: Next los transpila.
  transpilePackages: ["@arcade1v1/game-sdk", "@arcade1v1/agent-sdk"],
};

export default nextConfig;
