import { serve } from "bun";

// ponytail: serves dist/ as static, SPA fallback
const PORT = 5173;
const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const f = Bun.file("./dist" + url.pathname);
    if (await f.exists()) return new Response(f);
    return new Response(Bun.file("./dist/index.html"), {
      headers: { "Content-Type": "text/html" },
    });
  },
});

console.log(`🚀 http://localhost:${PORT}`);
