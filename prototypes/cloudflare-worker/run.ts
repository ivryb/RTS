const port = 8_799;
const worker = Bun.spawn([
  "pnpm",
  "exec",
  "wrangler",
  "dev",
  "--config",
  "prototypes/cloudflare-worker/wrangler.jsonc",
  "--port",
  String(port),
  "--inspector-port",
  String(port + 1),
  "--log-level",
  "error",
  "--show-interactive-dev-session=false",
], {
  cwd: new URL("../..", import.meta.url).pathname,
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: "/private/tmp/dune77-wrangler.log",
  },
  stdout: "pipe",
  stderr: "pipe",
});
const stdout = new Response(worker.stdout).text();
const stderr = new Response(worker.stderr).text();

try {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      response = await fetch(`http://127.0.0.1:${port}`);
      break;
    } catch {
      if (worker.exitCode !== null) break;
      await Bun.sleep(100);
    }
  }
  if (!response) {
    worker.kill();
    await worker.exited;
    throw new Error(`Cloudflare probe did not start:\n${await stdout}\n${await stderr}`);
  }
  if (!response.ok) {
    const body = await response.text();
    const summary = body
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(-2_000);
    throw new Error(`Cloudflare probe returned ${response.status}: ${summary}`);
  }
  console.log(await response.json());
} finally {
  worker.kill();
  await worker.exited;
}
