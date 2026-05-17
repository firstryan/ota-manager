import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import OTA_CONFIG from './ota-config.js';

const rootDir = process.cwd();
const ENV_PATH = path.join(rootDir, '.env');
const MAIN_MANIFEST_PATH = path.join(rootDir, 'src', 'data', 'update-data.json');
const OTA_RELEASES_DIR = path.join(rootDir, 'ota-releases');

let githubPat = '';
let gitlabPat = '';
if (fs.existsSync(ENV_PATH)) {
    const envContent = fs.readFileSync(ENV_PATH, 'utf-8');
    envContent.split('\n').forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
            if (match[1] === 'GITHUB_DEV_PAT') githubPat = match[2].replace(/['"]/g, '').trim();
            if (match[1] === 'GITLAB_DEV_PAT') gitlabPat = match[2].replace(/['"]/g, '').trim();
        }
    });
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

async function rollbackOTA() {
    const targetVersion = process.argv[2];
    const argChannel = process.argv[3] || 'training';

    if (!targetVersion) {
        console.log('❌ Error: Mohon tentukan versi tujuan rollback (e.g., npx ota-manager rollback 0.2.0.11 training)');
        process.exit(1);
    }

    console.log(`\n🔄 --- MEMULAI PROSES ROLLBACK OTA (${argChannel.toUpperCase()}) ---`);
    console.log(`🎯 Target Versi : v${targetVersion}`);
    console.log(`🔹 Strategy     : ${OTA_CONFIG.strategy.toUpperCase()}`);

    try {
        const config = OTA_CONFIG[OTA_CONFIG.strategy];
        if (!config || !config.repo) {
            throw new Error(`Repository not configured for strategy "${OTA_CONFIG.strategy}".`);
        }

        const channelConfig = config.channels?.[argChannel];
        const activeBranch = channelConfig?.branch || config.branch || 'main';

        console.log(`📂 Menyiapkan repositori OTA jarak jauh (Branch: ${activeBranch})...`);
        if (fs.existsSync(OTA_RELEASES_DIR)) {
            fs.rmSync(OTA_RELEASES_DIR, { recursive: true, force: true });
        }

        const pat = OTA_CONFIG.strategy === 'gitlab' ? gitlabPat : githubPat;
        const cloneRepo = config.repo.endsWith('.git') ? config.repo : config.repo + '.git';
        const authRepo = cloneRepo.replace('https://', `https://${pat}@`);

        execSync(`git clone --branch ${activeBranch} ${authRepo} "${OTA_RELEASES_DIR}"`, { stdio: 'inherit' });

        const zipFileName = `v${targetVersion.replace(/\./g, '_')}.zip`;
        const zipFilePath = path.join(OTA_RELEASES_DIR, zipFileName);

        console.log(`🔍 Memeriksa ketersediaan bungkusan fisik: ${zipFileName} di server...`);
        if (!fs.existsSync(zipFilePath)) {
            console.log(`\n❌ ERROR FATAL: File bungkusan ${zipFileName} TIDAK DITEMUKAN di repositori jarak jauh!`);
            console.log(`💡 Rollback dibatalkan karena versi tujuan tidak memiliki bungkusan fisik yang valid.`);
            process.exit(1);
        }
        console.log(`✅ File bungkusan fisik ${zipFileName} tersedia dan valid!`);

        const manifestFileName = argChannel === 'training' ? 'manifest-training.json' : 'manifest.json';
        const manifestPath = path.join(OTA_RELEASES_DIR, manifestFileName);

        const rawBaseUrl = getRawBaseUrl(config.repo, OTA_CONFIG.strategy, activeBranch);
        const activeOtaUrl = `${rawBaseUrl}/${manifestFileName}`;
        const activeZipUrl = `${rawBaseUrl}/${zipFileName}`;

        console.log(`📝 Memperbarui ${manifestFileName} jarak jauh ke versi ${targetVersion}...`);
        const manifest = {
            version: targetVersion,
            url: activeZipUrl
        };
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

        console.log(`📝 Memperbarui .env lokal ke versi ${targetVersion}...`);
        if (fs.existsSync(ENV_PATH)) {
            let envContent = fs.readFileSync(ENV_PATH, 'utf-8');
            envContent = envContent.replace(/PUBLIC_APP_VERSION_ANDROID=.*/, `PUBLIC_APP_VERSION_ANDROID=${targetVersion}`);
            envContent = envContent.replace(/PUBLIC_APP_VERSION_IOS=.*/, `PUBLIC_APP_VERSION_IOS=${targetVersion}`);
            if (envContent.includes('PUBLIC_APP_VERSION=')) {
                envContent = envContent.replace(/PUBLIC_APP_VERSION=.*/, `PUBLIC_APP_VERSION=${targetVersion}`);
            }
            if (envContent.includes('PUBLIC_OTA_UPDATE_URL=')) {
                envContent = envContent.replace(/PUBLIC_OTA_UPDATE_URL=.*/, `PUBLIC_OTA_UPDATE_URL=${activeOtaUrl}`);
            } else {
                envContent += `\nPUBLIC_OTA_UPDATE_URL=${activeOtaUrl}`;
            }
            fs.writeFileSync(ENV_PATH, envContent);
        }

        if (fs.existsSync(MAIN_MANIFEST_PATH)) {
            const updateManifest = JSON.parse(fs.readFileSync(MAIN_MANIFEST_PATH, 'utf8'));
            updateManifest.version = targetVersion;
            fs.writeFileSync(MAIN_MANIFEST_PATH, JSON.stringify(updateManifest, null, 2));
        }

        console.log(`📤 Mengirim manifest rollback ke repositori OTA jarak jauh...`);
        execSync('git add .', { cwd: OTA_RELEASES_DIR, stdio: 'ignore' });
        execSync(`git commit -m "chore: rollback OTA manifest to v${targetVersion} (${argChannel})"`, { cwd: OTA_RELEASES_DIR, stdio: 'ignore' });
        execSync(`git push origin ${activeBranch}`, { cwd: OTA_RELEASES_DIR, stdio: 'inherit' });

        console.log(`\n🎉 ROLLBACK SUKSES BERHASIL DIEKSEKUSI!`);
        console.log(`📄 Versi Aktif Sekarang : v${targetVersion}`);
        console.log(`🔗 Channel              : ${argChannel}`);
        console.log(`💡 Capgo di HP pengguna akan langsung mendeteksi manifest baru dan melakukan downgrade otomatis ke v${targetVersion}.\n`);

    } catch (e) {
        console.error(`\n❌ Rollback Gagal: ${e.message}\n`);
        process.exit(1);
    }
}

rollbackOTA();
