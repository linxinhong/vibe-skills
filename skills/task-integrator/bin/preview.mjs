#!/usr/bin/env node
import { main } from './preview-server.mjs';
main().catch(error => { console.error(error.message); process.exitCode = 1; });
