import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import OTA_CONFIG from './ota-config.js';
import { listConfigs, useConfig, registerConfig, testConnection } from './ota-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = process.cwd();

const command = process.argv[2];
const subArg = process.argv[3];
const versionArg = process.argv[4];

const TOOL_VERSION = '1.2.0';

const scripts = {
    version: path.join(__dirname, 'ota-version.js'),
    deploy: path.join(__dirname, 'ota-deploy.js'),
    verify: path.join(__dirname, 'verify-dist.cjs'),
    security: path.join(__dirname, 'ota-security.js'),
    build: path.join(__dirname, 'ota-build.cjs'),
};

function showHelp() {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                        OTA MANAGER                         ║
║                        Version ${TOOL_VERSION}                       ║
╚════════════════════════════════════════════════════════════╝

Usage: npx ota-manager <command> [sub-command] [version]

Management Commands:
  list      : Show all registered infrastructures.
  use <id>  : Set default infrastructure (e.g., use gitlab).
  register <id> : Register or update infrastructure (e.g., register s3).
  verify    : Verify active infrastructure connectivity.
  audit     : Audit public token for security leaks.
  test      : Run E2E simulation (Push & Read).

Operational Commands:
  status    : Check local vs remote version.
  deploy training : Deploy update to TRAINING channel.
  deploy live     : Deploy update to LIVE channel.

Active Infrastructure:
  Strategy : ${OTA_CONFIG.strategy.toUpperCase()}
  Repo     : ${OTA_CONFIG[OTA_CONFIG.strategy]?.repo || 'Not Configured'}
──────────────────────────────────────────────────────────────
    `);
}

import readline from 'readline';

function confirm(message) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(`\n⚠️  ${message} [y/N]: `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y');
        });
    });
}

async function run() {
    try {
        switch (command) {
            case 'list':
                await listConfigs();
                process.exit(0);
                break;

            case 'use':
                if (!subArg) {
                    console.log('❌ Error: Please specify the infrastructure ID (e.g., use gitlab).');
                    process.exit(1);
                }
                await useConfig(subArg);
                process.exit(0);
                break;

            case 'register':
                if (!subArg) {
                    console.log('❌ Error: Please specify the ID (e.g., register gitlab).');
                    process.exit(1);
                }
                await registerConfig(subArg);
                process.exit(0);
                break;

            case 'help':
            case '-h':
            case '--help':
                showHelp();
                process.exit(0);
                break;

            case '-v':
            case '--version':
                console.log(`OTA Manager v${TOOL_VERSION}`);
                process.exit(0);
                break;

            case 'status':
            case 'version':
                execSync(`node "${scripts.version}"`, { stdio: 'inherit' });
                process.exit(0);
                break;

            case 'verify':
                execSync(`node "${scripts.verify}"`, { stdio: 'inherit' });
                process.exit(0);
                break;

            case 'test':
                await testConnection();
                process.exit(0);
                break;

            case 'build':
                execSync(`node "${scripts.build}" ${subArg || ''}`, { stdio: 'inherit' });
                process.exit(0);
                break;

            case 'audit':
            case 'security-check':
            case 'security':
                execSync(`node "${scripts.security}"`, { stdio: 'inherit' });
                process.exit(0);
                break;

            case 'training':
                execSync(`node "${scripts.version}"`, { stdio: 'inherit' });
                execSync(`node "${scripts.verify}"`, { stdio: 'inherit' });
                
                console.log(`\n📋 DEPLOYMENT PLAN [TRAINING]`);
                console.log(`🔹 Infra   : ${OTA_CONFIG.strategy.toUpperCase()}`);
                console.log(`🔹 Action  : Build & Push to Training Channel`);
                
                if (await confirm('Proceed with TRAINING deployment?')) {
                    execSync(`node "${scripts.deploy}" training ${subArg || ''}`, { stdio: 'inherit' });
                } else {
                    console.log('❌ Deployment cancelled.');
                }
                process.exit(0);
                break;

            case 'live':
                execSync(`node "${scripts.version}"`, { stdio: 'inherit' });
                execSync(`node "${scripts.verify}"`, { stdio: 'inherit' });
                
                console.log(`\n🚨 WARNING: DEPLOYMENT KE LIVE [PRODUCTION]`);
                console.log(`🔹 Infra   : ${OTA_CONFIG.strategy.toUpperCase()}`);
                console.log(`🔹 Action  : Build & Push to LIVE Channel`);
                
                if (await confirm('ARE YOU SURE you want to deploy to LIVE?')) {
                    execSync(`node "${scripts.deploy}" live ${subArg || ''}`, { stdio: 'inherit' });
                } else {
                    console.log('❌ LIVE Deployment cancelled.');
                }
                process.exit(0);
                break;

            case 'deploy':
                if (!subArg) {
                    console.log('❌ Error: Mohon tentukan channel (e.g., deploy training atau deploy live).');
                    process.exit(1);
                }
                const channel = subArg.toLowerCase();
                if (channel !== 'training' && channel !== 'live') {
                    console.log(`❌ Error: Channel "${channel}" tidak dikenal. Gunakan 'training' atau 'live'.`);
                    process.exit(1);
                }

                execSync(`node "${scripts.version}"`, { stdio: 'inherit' });
                execSync(`node "${scripts.verify}"`, { stdio: 'inherit' });
                
                if (channel === 'training') {
                    console.log(`\n📋 DEPLOYMENT PLAN [TRAINING]`);
                    console.log(`🔹 Infra   : ${OTA_CONFIG.strategy.toUpperCase()}`);
                    console.log(`🔹 Action  : Build & Push to Training Channel`);
                } else {
                    console.log(`\n🚨 WARNING: DEPLOYMENT KE LIVE [PRODUCTION]`);
                    console.log(`🔹 Infra   : ${OTA_CONFIG.strategy.toUpperCase()}`);
                    console.log(`🔹 Action  : Build & Push to LIVE Channel`);
                }
                
                if (await confirm(`Proceed with ${channel.toUpperCase()} deployment?`)) {
                    execSync(`node "${scripts.deploy}" ${channel} ${versionArg || ''}`, { stdio: 'inherit' });
                } else {
                    console.log('❌ Deployment cancelled.');
                }
                process.exit(0);
                break;

            default:
                console.log(`\n❓ Unknown command: "${command || ''}"`);
                showHelp();
                process.exit(0);
                break;
        }
    } catch (error) {
        console.log(`\n❌ Process stopped due to error or cancellation.`);
        process.exit(1);
    }
}

run();
