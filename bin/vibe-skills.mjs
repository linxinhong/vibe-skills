#!/usr/bin/env node
import { main as preview } from '../skills/task-integrator/bin/preview-server.mjs';

const [command, ...args] = process.argv.slice(2);

if (!command || command === '--help' || command === '-h') {
  console.log(`Vibe Skills CLI

Usage:
  vibe-skills task-preview [options]

Commands:
  task-preview   Open the generic project task preview

Run "vibe-skills task-preview --help" for preview options.`);
} else if (command === 'task-preview') {
  try {
    await preview(args);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else {
  console.error(`Unknown command: ${command}\nRun "vibe-skills --help" for usage.`);
  process.exitCode = 1;
}
