import { Worker } from 'node:worker_threads';
import type { Execution, ShellState } from '../src/engine.ts';
let active = 0;
export async function runVirtual(command: string, state: ShellState): Promise<Execution> {
  if (active >= 8) throw Error('The virtual consoles are busy. Try again shortly.');
  active++;
  try {
    return await new Promise<Execution>((resolve, reject) => {
      const worker = new Worker(new URL('./runner.ts', import.meta.url), { workerData: { command, state }, resourceLimits: { maxOldGenerationSizeMb: 32 } });
      const timer = setTimeout(() => { void worker.terminate(); reject(Error('Command timed out. Simplify your pattern.')); }, 1500);
      worker.once('message', result => { clearTimeout(timer); void worker.terminate(); resolve(result); });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
    });
  } finally { active--; }
}
