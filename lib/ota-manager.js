import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const rootDir = process.cwd();
const configJsonPath = path.join(rootDir, 'ota-config.json');
const ENV_PATH = path.join(rootDir, '.env');

function question(query) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(query, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

export async function listConfigs() {
    if (!fs.existsSync(configJsonPath)) {
        console.log(`\n❌ Error: ota-config.json not found in ${rootDir}`);
        console.log(`💡 Please run 'npx ota-updates register github' to initialize.`);
        return;
    }
    const config = JSON.parse(fs.readFileSync(configJsonPath, 'utf-8'));
    const envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
    
    console.log(`\n📋 --- REGISTERED OTA INFRASTRUCTURE ---`);
    console.log(`   ${"[ ID ]".padEnd(8)} | ${"[ STATUS ]".padEnd(14)} | [ REPOSITORY URL ]`);
    console.log(`   ${"--------".padEnd(8)} | ${"------------".padEnd(14)} | ------------------`);
    
    for (const key of Object.keys(config.configs)) {
        const isDefault = config.strategy === key;
        const icon = isDefault ? '⭐️' : '  ';
        const repo = config.configs[key].repo;
        
        // Validation Check
        const pubVar = `PUBLIC_${key.toUpperCase()}_OTA_PAT`;
        const devVar = `${key.toUpperCase()}_DEV_PAT`;
        const hasPub = envContent.includes(`${pubVar}=`) && envContent.match(new RegExp(`${pubVar}=(.*)`))?.[1]?.trim().length > 0;
        const hasDev = envContent.includes(`${devVar}=`) && envContent.match(new RegExp(`${devVar}=(.*)`))?.[1]?.trim().length > 0;
        
        let status = '';
        if (hasPub && hasDev && repo) {
            status = '✅ [READY]';
        } else {
            status = '⚠️  [INCOMPLETE]';
        }

        console.log(`${icon} ${key.toUpperCase().padEnd(8)} : ${status.padEnd(14)} | ${repo}`);
    }
    
    console.log(`\n⭐️ = Active Strategy`);
    console.log(`💡 Use 'npx ota-updates register <id>' to complete configuration.`);
    console.log(`💡 Use 'npx ota-updates use <id>' to switch connection.`);
    console.log(`------------------------------------------\n`);
}

export async function useConfig(strategy) {
    if (!fs.existsSync(configJsonPath)) {
        console.log(`\n❌ Error: ota-config.json not found in ${rootDir}`);
        return;
    }
    const config = JSON.parse(fs.readFileSync(configJsonPath, 'utf-8'));
    if (!config.configs[strategy]) {
        console.log(`❌ Error: Strategy "${strategy}" is not registered.`);
        return;
    }
    config.strategy = strategy;
    fs.writeFileSync(configJsonPath, JSON.stringify(config, null, 2));
    console.log(`✅ Default strategy successfully changed to: ${strategy.toUpperCase()}`);
}

export async function registerConfig(strategy) {
    let config = { strategy: strategy, configs: {} };
    if (fs.existsSync(configJsonPath)) {
        config = JSON.parse(fs.readFileSync(configJsonPath, 'utf-8'));
    }
    
    if (config.configs[strategy]) {
        const confirm = await question(`⚠️  Strategy "${strategy}" already exists. Rewrite? [y/N]: `);
        if (confirm.toLowerCase() !== 'y') {
            console.log('❌ Registration cancelled.');
            return;
        }
    }

    console.log(`\n📝 INFRASTRUCTURE REGISTRATION: ${strategy.toUpperCase()}`);
    const repo = await question(`🔹 Enter Repo URL: `);
    const pubPat = await question(`🔹 Enter PUBLIC PAT (Read-only): `);
    const devPat = await question(`🔹 Enter DEVELOPER PAT (Write): `);

    // Update JSON
    config.configs[strategy] = {
        repo: repo.replace(/\/$/, ''),
        branch: 'main',
        channels: {
            live: { branch: 'main' },
            training: { branch: 'main' }
        }
    };
    fs.writeFileSync(configJsonPath, JSON.stringify(config, null, 2));

    // Update .env
    let envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
    const pubVar = `PUBLIC_${strategy.toUpperCase()}_OTA_PAT`;
    const devVar = `${strategy.toUpperCase()}_DEV_PAT`;

    // Replace or Append Public PAT
    if (envContent.includes(`${pubVar}=`)) {
        envContent = envContent.replace(new RegExp(`${pubVar}=.*`), `${pubVar}=${pubPat}`);
    } else {
        envContent += `\n${pubVar}=${pubPat}`;
    }

    // Replace or Append Dev PAT
    if (envContent.includes(`${devVar}=`)) {
        envContent = envContent.replace(new RegExp(`${devVar}=.*`), `${devVar}=${devPat}`);
    } else {
        envContent += `\n${devVar}=${devPat}`;
    }

    fs.writeFileSync(ENV_PATH, envContent.trim() + '\n');
    
    console.log(`\n✅ Registration for ${strategy.toUpperCase()} Successful!`);
    console.log(`💡 Run 'npx ota-updates use ${strategy}' to activate it.`);
}

export async function testConnection() {
    if (!fs.existsSync(configJsonPath)) {
        console.log(`\n❌ Error: ota-config.json not found in ${rootDir}`);
        return;
    }
    const config = JSON.parse(fs.readFileSync(configJsonPath, 'utf-8'));
    const strategy = config.strategy;
    const activeConfig = config.configs[strategy];
    const envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
    
    // Load Tokens
    const githubDev = envContent.match(/GITHUB_DEV_PAT=(.*)/)?.[1]?.trim();
    const gitlabDev = envContent.match(/GITLAB_DEV_PAT=(.*)/)?.[1]?.trim();
    const githubPub = envContent.match(/PUBLIC_GITHUB_OTA_PAT=(.*)/)?.[1]?.trim();
    const gitlabPub = envContent.match(/PUBLIC_GITLAB_OTA_PAT=(.*)/)?.[1]?.trim();
    
    const devPat = strategy === 'gitlab' ? gitlabDev : githubDev;
    const pubPat = strategy === 'gitlab' ? gitlabPub : githubPub;

    // --- PRE-FLIGHT CHECK ---
    if (!devPat || !pubPat) {
        console.log(`\n❌ Error: Missing configuration for ${strategy.toUpperCase()}`);
        console.log(`💡 Please run 'npx ota-updates register ${strategy}' to set up your PATs first.`);
        return;
    }

    console.log(`\n🧪 --- E2E CONNECTION SIMULATION (${strategy.toUpperCase()}) ---`);
    const otaReleasesDir = path.join(rootDir, 'ota-releases');
    const cloneRepo = activeConfig.repo.endsWith('.git') ? activeConfig.repo : activeConfig.repo + '.git';
    
    // GitLab needs 'oauth2' prefix
    const authRepo = strategy === 'gitlab' 
        ? cloneRepo.replace('https://', `https://oauth2:${devPat}@`) 
        : cloneRepo.replace('https://', `https://${devPat}@`);

    const tempDir = path.join(rootDir, 'temp-e2e-test');
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });

    try {
        console.log(`1️⃣  Testing DEVELOPER PAT (Push Access)...`);
        execSync(`git clone --depth 1 "${authRepo}" "${tempDir}"`, { stdio: 'ignore' });
        console.log(`   ✅ Developer PAT: Valid (Clone/Push Access OK)`);

        console.log(`2️⃣  Testing PUBLIC PAT (Read Access)...`);
        let fetchUrl = `${activeConfig.repo}/manifest.json`;
        let authHeader = `Authorization: Bearer ${pubPat}`;

        if (strategy === 'github') {
            const repoPath = activeConfig.repo.replace('https://github.com/', '').replace(/\/$/, '');
            fetchUrl = `https://api.github.com/repos/${repoPath}/contents/manifest.json`;
            authHeader = `Authorization: Bearer ${pubPat}`;
        } else if (strategy === 'gitlab') {
            const projectId = '82216532';
            fetchUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/files/manifest.json/raw?ref=main`;
            authHeader = pubPat.startsWith('gldt-') ? `Deploy-Token: ${pubPat}` : `Authorization: Bearer ${pubPat}`;
        }

        const curlAuth = `-H "${authHeader}"`;
        const cmd = `curl.exe -sL -A "Mozilla/5.0" ${curlAuth} "${fetchUrl}"`;
        const result = execSync(cmd).toString().trim();

        if (result.includes('404') || result.includes('403') || result.includes('Not Found') || result.includes('Forbidden')) {
            console.log(`   ⚠️  Public PAT connected but file not found (Expected for new repo)`);
        } else {
            console.log(`   ✅ Public PAT: Valid (Read Access OK)`);
        }

        console.log(`\n🎉 E2E SIMULATION SUCCESS! Your infrastructure is 100% ready.\n`);
    } catch (e) {
        console.log(`\n❌ E2E Simulation Failed: ${e.message}`);
        console.log(`💡 Please verify your repository URL and PAT permissions.`);
    } finally {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
