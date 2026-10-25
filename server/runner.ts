import { parentPort, workerData } from 'node:worker_threads';
import { execute } from '../src/engine.ts';
parentPort!.postMessage(execute(workerData.command, workerData.state));
