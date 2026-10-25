import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createFiles, MISSIONS, isComplete } from '../src/missions.ts';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function runVirtual(command: string, cwd: string): Promise<unknown> {
  return new Promise((resolveResult, reject) => {
    // This is a JavaScript worker, not an OS shell or subprocess.
    const worker = new Worker(new URL('./runner.ts', import.meta.url), { workerData: { command, state: { cwd, files: createFiles() } }, resourceLimits: { maxOldGenerationSizeMb: 32 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(Error('Command timed out. Simplify your pattern.')); }, 1500);
    worker.once('message', result => { clearTimeout(timer); void worker.terminate(); resolveResult(result); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
  });
}
let activeCommands = 0;
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'self'; frame-ancestors 'self'");
  const json = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/health') { json(200, { ok: true, engine: 'virtual' }); return; }
    if (url.pathname === '/api/run') {
      if (req.method !== 'POST') { json(405, { error: 'Use POST.' }); return; }
      if (activeCommands >= 8) { json(429, { error: 'The lab is busy. Try again shortly.' }); return; }
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) { json(403, { error: 'Cross-origin requests are not supported.' }); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 8192) { json(413, { error: 'Request too large.' }); return; } }
      let parsed: { command?: unknown; cwd?: unknown; missionId?: unknown };
      try { parsed = JSON.parse(body); } catch { json(400, { error: 'Expected JSON.' }); return; }
      const { command, cwd = '/workspace', missionId } = parsed;
      if (typeof command !== 'string' || command.length > 4096 || typeof cwd !== 'string' || cwd.length > 256 || !cwd.startsWith('/')) { json(400, { error: 'Invalid command or virtual directory.' }); return; }
      activeCommands++;
      try {
        const result = await runVirtual(command, cwd) as import('../src/engine.ts').Execution;
        const mission = MISSIONS.find(m => m.id === missionId);
        json(200, { ...result, complete: mission ? isComplete(mission, result) : false });
      } finally { activeCommands--; }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { json(405, { error: 'Method not supported.' }); return; }
    const name = decodeURIComponent(url.pathname) === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    const path = resolve(root, name);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { json(403, { error: 'Forbidden.' }); return; }
    let data: Buffer;
    try { data = await readFile(path); } catch { json(404, { error: 'Not found. Run npm run build before npm start.' }); return; }
    const extension = path.slice(path.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': types[extension] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) { json(500, { error: (error as Error).message }); }
});
server.listen(port, host, () => console.log(`Grep Quest listening on ${host}:${port}`));
