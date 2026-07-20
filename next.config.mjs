/** @type {import('next').NextConfig} */
const nextConfig = {
  // /api/extract lit le prompt au runtime : on force son inclusion dans le bundle
  // de la fonction serverless. (Le template Word, lui, est servi en statique depuis
  // public/ et récupéré par le navigateur qui génère le .docx localement.)
  experimental: {
    outputFileTracingIncludes: {
      "/api/extract": ["./prompt_diagnostic.md"],
    },
  },
};

export default nextConfig;
