#!/usr/bin/env node
import { main } from '../skills/task-integrator/bin/preview-server.mjs';

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
