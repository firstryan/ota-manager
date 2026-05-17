#!/usr/bin/env node

import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mainScript = path.join(__dirname, '../lib/ota-main.js');

const args = process.argv.slice(2);
const child = fork(mainScript, args, { stdio: 'inherit', cwd: process.cwd() });

child.on('exit', code => {
    process.exit(code);
});
