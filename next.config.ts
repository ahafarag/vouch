import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PayPal agent toolkit pulls in LangChain/OpenAI/MCP deps; keep it out of the bundle.
  serverExternalPackages: ["@paypal/agent-toolkit"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
