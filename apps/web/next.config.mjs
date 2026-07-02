/** @type {import('next').NextConfig} */
const nextConfig = {
  // El motor compartido (game-sdk) y el cliente del arbitro (agent-sdk)
  // vienen en TypeScript: Next los transpila.
  transpilePackages: ["@arcade1v1/game-sdk", "@arcade1v1/agent-sdk"],

  // Cabeceras de seguridad para una app que firma transacciones de dinero:
  // sobre todo prohibir que OTRO sitio nos meta en un iframe (clickjacking
  // sobre los botones de depositar/cobrar).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
