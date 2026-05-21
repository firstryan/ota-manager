import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import OTA_CONFIG from './ota-config.js';

const rootDir = process.cwd();
const ENV_PATH = path.join(rootDir, '.env');

// Helper to construct Raw URL based on provider and branch
function getRawBaseUrl(repoUrl, strategy, branch = 'main') {
    let base = repoUrl.replace(/\/$/, '');
    if (strategy === 'github') {
        return base.replace('github.com', 'raw.githubusercontent.com') + `/${branch}`;
    } else if (strategy === 'gitlab') {
        return base + `/-/raw/${branch}`;
    }
    return base;
}

async function checkStatus() {
    console.log(`\n🔍 --- OTA VERSION STATUS ---`);

    if (!fs.existsSync(ENV_PATH)) {
        console.log(`\n❌ Error: .env file not found in ${rootDir}`);
        return;
    }

    // 1. Get Local Version & Native Status
    const envContent = fs.readFileSync(ENV_PATH, 'utf-8');
    const localVersion = envContent.match(/PUBLIC_APP_VERSION_ANDROID=(.*)/)?.[1]?.trim().replace(/^"|"$/g, '') || envContent.match(/PUBLIC_APP_VERSION=(.*)/)?.[1]?.trim().replace(/^"|"$/g, '');
    const appId = envContent.match(/PUBLIC_APP_ID=(.*)/)?.[1]?.trim().replace(/^"|"$/g, '') || 'com.cyclopedia.one_eighty_run';
    console.log(`💻 Local Version (.env) : ${localVersion || 'unknown'}`);
    console.log(`📦 App ID / Package Name : ${appId}`);

    // Cek Android versionCode
    const buildGradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');
    let androidVersionCode = 'unknown';
    if (fs.existsSync(buildGradlePath)) {
        const bgContent = fs.readFileSync(buildGradlePath, 'utf8');
        const match = bgContent.match(/versionCode\s+(\d+)/);
        if (match) androidVersionCode = match[1];
    }
    console.log(`🤖 Android versionCode    : ${androidVersionCode}`);

    // Cek iOS CURRENT_PROJECT_VERSION
    const pbxprojPath = path.join(rootDir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
    let iosProjectVersion = 'unknown';
    if (fs.existsSync(pbxprojPath)) {
        const pbxContent = fs.readFileSync(pbxprojPath, 'utf8');
        const match = pbxContent.match(/CURRENT_PROJECT_VERSION = (\d+);/);
        if (match) iosProjectVersion = match[1];
    }
    console.log(`🍏 iOS Project Version    : ${iosProjectVersion}`);

    // 2. Get Remote Version based on Config
    const strategy = OTA_CONFIG.strategy;
    const config = OTA_CONFIG[strategy];
    if (!config || !config.repo) {
        console.log(`\n❌ Error: Repository not configured for strategy "${strategy}".`);
        console.log(`💡 Please run 'npx ota-updates register ${strategy}' to configure.`);
        return;
    }

    const channel = envContent.match(/PUBLIC_APP_CHANNEL=(.*)/)?.[1]?.trim().replace(/^"|"$/g, '') || 'training';
    
    // Determine branch
    const channelConfig = config.channels?.[channel];
    const activeBranch = channelConfig?.branch || config.branch || 'main';
    
    const manifestFile = channel === 'training' ? 'manifest-training.json' : 'manifest.json';
    const rawBaseUrl = getRawBaseUrl(config.repo, strategy, activeBranch);
    const versionUrl = `${rawBaseUrl}/${manifestFile}`;

    // Get PAT for auth
    const githubPat = envContent.match(/PUBLIC_GITHUB_OTA_PAT=(.*)/)?.[1]?.trim();
    const gitlabPat = envContent.match(/PUBLIC_GITLAB_OTA_PAT=(.*)/)?.[1]?.trim();
    const pat = strategy === 'gitlab' ? gitlabPat : githubPat;

    try {
        console.log(`🌐 Checking ${strategy.toUpperCase()} (${channel}) [Branch: ${activeBranch}]...`);
        
        let fetchUrl = versionUrl;
        let authHeader = strategy === 'github' ? `Authorization: token ${pat}` : `Authorization: Bearer ${pat}`;

        if (strategy === 'gitlab') {
            const projectId = '82216532'; // suryabumipermata / one-eighty-run-apps-ota
            fetchUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/files/${manifestFile}/raw?ref=${activeBranch}`;
            
            if (pat && pat.startsWith('gldt-')) {
                authHeader = `Deploy-Token: ${pat}`;
            } else {
                authHeader = `Authorization: Bearer ${pat}`;
            }
        }

        const curlAuth = authHeader && pat ? `-H "${authHeader}"` : '';
        const cmd = `curl.exe -sL -A "Mozilla/5.0" ${curlAuth} "${fetchUrl}"`;
        const result = execSync(cmd).toString().trim();
        
        if (!result || result === 'Not Found' || result.includes('404: Not Found') || result.includes('message')) {
            // Check for 404 from API
            if (result.includes('404') || result.includes('File Not Found')) throw new Error('File not found');
            if (result.includes('403') || result.includes('Forbidden')) throw new Error('Auth failed');
            throw new Error('File not found');
        }

        const remoteData = JSON.parse(result);
        const remoteVersion = remoteData.version || remoteData[channel]?.version;

        if (!remoteVersion) {
            console.log(`✨ Status: CHANNEL "${channel.toUpperCase()}" KOSONG (Belum ada rilis)`);
            console.log(`💡 Jalankan 'npm run ota-manager deploy ${channel}' untuk merilis versi perdana ke channel ini!`);
        } else if (remoteVersion === localVersion) {
            console.log(`✅ Status: UP TO DATE (${remoteVersion})`);
        } else {
            console.log(`⚠️  Status: OUTDATED!`);
            console.log(`📡 Remote Version : ${remoteVersion}`);
            console.log(`💡 Run 'npm run ota-updates ${channel}' to update.`);
        }
    } catch (e) {
        if (e.message === 'File not found') {
            console.log(`✨ Status: NEW INFRASTRUCTURE (0.0.0)`);
            console.log(`💡 No releases found on server. Ready for initial deployment!`);
        } else {
            console.log(`❌ Could not fetch remote manifest.`);
            console.log(`🔗 URL: ${versionUrl}`);
            console.log(`💡 HINT: Ensure internet connection is stable or check your PAT.`);
        }
    }
    console.log(`------------------------------------\n`);
}

checkStatus();
