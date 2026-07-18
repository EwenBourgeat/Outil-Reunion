/** @type {import('next').NextConfig} */
const nextConfig = {
  // /api/generate lit le template Word et le prompt au runtime : on force leur
  // inclusion dans le bundle de la fonction serverless (vérifié via build standalone).
  experimental: {
    outputFileTracingIncludes: {
      "/api/generate": ["./assets/**", "./prompt_diagnostic.md"],
    },
  },
};

export default nextConfig;
