/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  experimental: {
    outputFileTracingIncludes: {
      '/api/admin/export/bot-data': ['./node_modules/sql.js/dist/sql-wasm.wasm']
    }
  }
};

export default nextConfig;
