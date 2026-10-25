import { execute } from './engine.ts';
import type { ShellState } from './engine.ts';
self.onmessage = (event: MessageEvent<{ command: string; state: ShellState }>) => {
  self.postMessage(execute(event.data.command, event.data.state));
};
