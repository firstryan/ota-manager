import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import OTA_CONFIG from './ota-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = process.cwd();

const OTA_RELEASES_DIR = path.join(rootDir, 'ota-releases');
const DIST_DIR = path.join(rootDir, 'dist');
const ENV_PATH = path.join(rootDir, '.env');
const MAIN_MANIFEST_PATH = path.join(rootDir, 'src', 'data', 'update-data.json');
const API_DIR = path.join(rootDir, 'src', 'pages', 'api');
const API_BACKUP_DIR = path.join(rootDir, 'src', '_api-backup');

const VERIFY_SCRIPT = path.join(__dirname, 'verify-dist.cjs');
const FLATTEN_SCRIPT = path.join(__dirname, 'flatten-dist.cjs');

function hideApi() {
    if (fs.existsSync(API_DIR)) {
        console.log('🙈 Hiding API routes (Using Robust Move)...');
        try {
            if (fs.existsSync(API_BACKUP_DIR)) fs.rmSync(API_BACKUP_DIR, { recursive: true, force: true });
            
            if (process.platform === 'win32') {
                try {
                    execSync(`robocopy "${API_DIR}" "${API_BACKUP_DIR}" /E /MOVE /NFL /NDL /NJH /NJS`, { stdio: 'ignore' });
                } catch (e) {
                    if (fs.existsSync(API_DIR)) throw e;
                }
            } else {
                fs.renameSync(API_DIR, API_BACKUP_DIR);
            }
            console.log('✅ API routes hidden.');
        } catch (e) {
            console.warn(`⚠️  Warning: Could not hide API routes (${e.message}).`);
        }
    }
}

function showApi() {
    if (fs.existsSync(API_BACKUP_DIR)) {
        console.log('🐵 Restoring API routes...');
        try {
            if (process.platform === 'win32') {
                try {
                    execSync(`robocopy "${API_BACKUP_DIR}" "${API_DIR}" /E /MOVE /NFL /NDL /NJH /NJS`, { stdio: 'ignore' });
                } catch (e) {
                    if (fs.existsSync(API_BACKUP_DIR)) throw e;
                }
            } else {
                if (fs.existsSync(API_DIR)) fs.rmSync(API_DIR, { recursive: true, force: true });
                fs.renameSync(API_BACKUP_DIR, API_DIR);
            }
            console.log('✅ API routes restored.');
        } catch (e) {
            console.error(`❌ Error: Failed to restore API routes: ${e.message}`);
        }
    }
}

const envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
const githubPat = envContent.match(/GITHUB_DEV_PAT=(.*)/)?.[1]?.trim().replace(/^"|"$/g, '') || '';
const gitlabPat = envContent.match(/GITLAB_DEV_PAT=(.*)/)?.[1]?.trim().replace(/^"|"$/g, '') || '';

const MAX_OTA_SIZE_MB = 50;

function getDirHash(dirPath) {
    if (!fs.existsSync(dirPath)) return '';
    const hash = crypto.createHash('sha256');
    const files = fs.readdirSync(dirPath, { recursive: true });
    files.sort().forEach(file => {
        const fullPath = path.join(dirPath, file);
        const stats = fs.statSync(fullPath);
        if (stats.isFile()) {
            hash.update(file);
            hash.update(fs.readFileSync(fullPath));
        }
    });
    return hash.digest('hex');
}

function getDirSize(dirPath) {
    let size = 0;
    if (!fs.existsSync(dirPath)) return 0;
    const files = fs.readdirSync(dirPath);
    for (let i = 0; i < files.length; i++) {
        const filePath = path.join(dirPath, files[i]);
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
            size += stats.size;
        } else if (stats.isDirectory()) {
            size += getDirSize(filePath);
        }
    }
    return size;
}

function getRawBaseUrl(repoUrl, strategy, branch = 'main') {
    let base = repoUrl.replace(/\/$/, '');
    if (strategy === 'github') {
        return base.replace('github.com', 'raw.githubusercontent.com') + `/${branch}`;
    } else if (strategy === 'gitlab') {
        return base + `/-/raw/${branch}`;
    }
    return base;
}

async function deployOTA() {
    console.log(`🚀 Starting OTA Deployment (Strategy: ${OTA_CONFIG.strategy})...`);

    const argChannel = process.argv[2] || 'training'; 
    
    try {
        if (!fs.existsSync(OTA_RELEASES_DIR)) fs.mkdirSync(OTA_RELEASES_DIR);
        
        const config = OTA_CONFIG[OTA_CONFIG.strategy];
        if (!config || !config.repo) {
            throw new Error(`Repository not configured for strategy "${OTA_CONFIG.strategy}". Run 'npx ota-updates register ${OTA_CONFIG.strategy}' first.`);
        }
        
        const channelConfig = config.channels?.[argChannel];
        const activeBranch = channelConfig?.branch || config.branch || 'main';

        console.log(`📂 Preparing ${OTA_CONFIG.strategy} OTA Repository (Branch: ${activeBranch})...`);
        if (fs.existsSync(OTA_RELEASES_DIR)) {
            fs.rmSync(OTA_RELEASES_DIR, { recursive: true, force: true });
        }
        
        const pat = OTA_CONFIG.strategy === 'gitlab' ? gitlabPat : githubPat;
        
        const cloneRepo = config.repo.endsWith('.git') ? config.repo : config.repo + '.git';
        const authRepo = cloneRepo.replace('https://', `https://${pat}@`);
        
        execSync(`git clone --branch ${activeBranch} ${authRepo} "${OTA_RELEASES_DIR}"`, { stdio: 'inherit' });

        if (!pat) {
            throw new Error(`Developer PAT for ${OTA_CONFIG.strategy.toUpperCase()} is missing in .env! Run 'npx ota-updates register ${OTA_CONFIG.strategy}' to fix it.`);
        }

        const currentEnv = fs.readFileSync(ENV_PATH, 'utf-8');
        const versionMatch = currentEnv.match(/PUBLIC_APP_VERSION_ANDROID=([0-9.]+)/);
        const currentVersion = versionMatch ? versionMatch[1] : '0.1.9.0';
        const otaManifestPath = path.join(OTA_RELEASES_DIR, argChannel === 'training' ? 'manifest-training.json' : 'manifest.json');
        
        let previousHash = null;
        let previousVersion = currentVersion;
        if (fs.existsSync(otaManifestPath)) {
            const otaManifest = JSON.parse(fs.readFileSync(otaManifestPath, 'utf8'));
            previousVersion = otaManifest.version || currentVersion;
            previousHash = otaManifest.hash || null;
        }

        console.log('🏗️ Building project for OTA Diff Check...');
        hideApi();
        try {
            execSync('npm run build', { stdio: 'inherit', cwd: rootDir });
            
            if (fs.existsSync(FLATTEN_SCRIPT)) {
                console.log('🚀 Running Tsar Bomba Path Cleanse...');
                execSync(`node "${FLATTEN_SCRIPT}"`, { stdio: 'inherit', cwd: rootDir });
            }

            if (fs.existsSync(VERIFY_SCRIPT)) {
                console.log('🔍 Running Pre-Flight Verification...');
                execSync(`node "${VERIFY_SCRIPT}"`, { stdio: 'inherit', cwd: rootDir });
            }
        } finally {
            showApi();
        }

        console.log('🧠 Calculating SHA-256 Hash of dist/ artifacts...');
        const currentBuildHash = getDirHash(DIST_DIR);
        console.log(`🔑 Current Build Hash : ${currentBuildHash.substring(0, 16)}...`);
        if (previousHash) {
            console.log(`🔒 Previous Release Hash: ${previousHash.substring(0, 16)}...`);
        }

        if (previousHash && previousHash === currentBuildHash) {
            console.log(`\nℹ️ [SMART DIFF CHECKER] No changes detected in build artifacts.`);
            console.log(`✅ Deploy Success (Skipped remote push to save bandwidth & Git storage).`);
            console.log(`📄 Active Version: ${previousVersion} (Unchanged)`);
            console.log(`🔗 Channel: ${argChannel}\n`);
            process.exit(0);
        }

        let nextVersion = process.argv[3];
        if (!nextVersion) {
            console.log('🔍 Changes detected! Auto-incrementing from remote manifest...');
            const parts = previousVersion.split('.');
            const lastIdx = parts.length - 1;
            parts[lastIdx] = (parseInt(parts[lastIdx]) + 1).toString();
            nextVersion = parts.join('.');
            console.log(`📈 Auto-increment: ${previousVersion} -> ${nextVersion}`);
        }

        console.log(`📦 Target Version: ${nextVersion} [${argChannel}]`);

        const rawBaseUrl = getRawBaseUrl(config.repo, OTA_CONFIG.strategy, activeBranch);
        const manifestFileName = argChannel === 'training' ? 'manifest-training.json' : 'manifest.json';
        const activeOtaUrl = `${rawBaseUrl}/${manifestFileName}`;
        
        console.log(`🔗 Auto-Constructing Raw OTA URL: ${activeOtaUrl}`);
        
        let updatedEnv = currentEnv;
        updatedEnv = updatedEnv.replace(/PUBLIC_APP_VERSION_ANDROID=.*/, `PUBLIC_APP_VERSION_ANDROID=${nextVersion}`);
        updatedEnv = updatedEnv.replace(/PUBLIC_APP_VERSION_IOS=.*/, `PUBLIC_APP_VERSION_IOS=${nextVersion}`);
        
        if (updatedEnv.includes('PUBLIC_APP_VERSION=')) {
            updatedEnv = updatedEnv.replace(/PUBLIC_APP_VERSION=.*/, `PUBLIC_APP_VERSION=${nextVersion}`);
        }
        
        if (updatedEnv.includes('PUBLIC_OTA_UPDATE_URL=')) {
            updatedEnv = updatedEnv.replace(/PUBLIC_OTA_UPDATE_URL=.*/, `PUBLIC_OTA_UPDATE_URL=${activeOtaUrl}`);
        } else {
            updatedEnv += `\nPUBLIC_OTA_UPDATE_URL=${activeOtaUrl}`;
        }
        
        console.log(`📝 Updating .env to version ${nextVersion} (Android & iOS) and setting OTA target...`);
        fs.writeFileSync(ENV_PATH, updatedEnv);
        
        if (fs.existsSync(MAIN_MANIFEST_PATH)) {
            const manifest = JSON.parse(fs.readFileSync(MAIN_MANIFEST_PATH, 'utf8'));
            manifest.version = nextVersion;
            fs.writeFileSync(MAIN_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
        }

        console.log('🛡️  Size Guardian: Checking dist/ folder size...');
        const distSizeBytes = getDirSize(DIST_DIR);
        const distSizeMB = distSizeBytes / (1024 * 1024);
        console.log(`📊 Estimated Size: ${distSizeMB.toFixed(2)} MB`);

        if (distSizeMB > MAX_OTA_SIZE_MB) {
            throw new Error(`CRITICAL SIZE VIOLATION: Folder dist/ has bloated to ${distSizeMB.toFixed(2)} MB! Limit is ${MAX_OTA_SIZE_MB} MB. Packaging aborted to prevent ZIP BOMB!`);
        }

        const otaName = `v${nextVersion.replace(/\./g, '_')}.zip`;
        const otaPath = path.join(rootDir, otaName);

        const isWindows = process.platform === 'win32';
        const tarCmd = isWindows ? 'tar.exe' : 'tar';
        const zipCmd = `${tarCmd} -a -c -f "${otaPath}" -C "${DIST_DIR}" .`;
        
        execSync(zipCmd, { stdio: 'inherit' });

        console.log('🛡️  Verifying ZIP Integrity...');
        try {
            execSync(`${tarCmd} -t -f "${otaPath}"`, { stdio: 'ignore' });
            console.log('✅ ZIP is valid and readable.');
        } catch (e) {
            throw new Error('CRITICAL: Generated ZIP is corrupt or invalid!');
        }

        const zipStats = fs.statSync(otaPath);
        const zipSizeMB = zipStats.size / (1024 * 1024);
        console.log(`📊 Final ZIP Size: ${zipSizeMB.toFixed(2)} MB`);

        if (zipSizeMB > MAX_OTA_SIZE_MB) {
            if (fs.existsSync(otaPath)) fs.unlinkSync(otaPath);
            throw new Error(`CRITICAL SIZE VIOLATION: ZIP file bloated to ${zipSizeMB.toFixed(2)} MB! Deployment aborted!`);
        }

        await deployToRemote(otaPath, otaName, nextVersion, argChannel, activeBranch, currentBuildHash);

        console.log(`\n✅ OTA DEPLOY SUCCESS!`);
        console.log(`📄 Version: ${nextVersion}`);
        console.log(`🔗 Channel: ${argChannel}\n`);

    } catch (error) {
        console.error(`\n❌ Deployment Failed: ${error.message}\n`);
        process.exit(1);
    } finally {
        showApi();
    }
}

async function deployToRemote(otaPath, otaName, version, channel, branch, buildHash) {
    const config = OTA_CONFIG[OTA_CONFIG.strategy];
    const pat = OTA_CONFIG.strategy === 'gitlab' ? gitlabPat : githubPat;
    console.log(`🚀 Pushing to ${OTA_CONFIG.strategy} (Branch: ${branch})...`);
    
    const targetPath = path.join(OTA_RELEASES_DIR, otaName);
    fs.copyFileSync(otaPath, targetPath);

    const manifestPath = path.join(OTA_RELEASES_DIR, 'manifest.json');
    let manifest = { live: {}, training: {} };
    if (fs.existsSync(manifestPath)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    }

    const rawBaseUrl = getRawBaseUrl(config.repo, OTA_CONFIG.strategy, branch);
    manifest[channel] = {
        version,
        url: `${rawBaseUrl}/${otaName}`,
        date: new Date().toISOString(),
        hash: buildHash || '',
        note: `Update to ${version} (${channel})`
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const flatManifestPath = path.join(OTA_RELEASES_DIR, `manifest-${channel}.json`);
    fs.writeFileSync(flatManifestPath, JSON.stringify(manifest[channel], null, 2));
    
    execSync(`git add .`, { cwd: OTA_RELEASES_DIR });
    execSync(`git commit -m "release: v${version} for ${channel}"`, { cwd: OTA_RELEASES_DIR });
    execSync(`git push origin ${branch}`, { cwd: OTA_RELEASES_DIR });

    if (fs.existsSync(otaPath)) fs.unlinkSync(otaPath);
}

deployOTA();
