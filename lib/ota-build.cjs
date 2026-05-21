const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');
const crypto = require('crypto');

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

const rootDir = process.cwd();
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
            const key = match[1];
            let value = match[2] || '';
            if (value.length > 0 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
            if (value.length > 0 && value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
            process.env[key] = value.trim();
        }
    });
}

function isBase64(str) {
    if (!str) return false;
    const clean = str.replace(/\s+/g, '');
    if (clean.length === 0) return false;
    const regex = /^[A-Za-z0-9+/=]+$/;
    return regex.test(clean);
}

function getBase64OrFileContent(val) {
    if (!val) return '';
    try {
        if (fs.existsSync(val)) {
            const fileContent = fs.readFileSync(val);
            const textContent = fileContent.toString('utf8').trim();
            
            if (textContent.includes('=')) {
                const match = textContent.match(/^\s*[\w.-]+\s*=\s*(.*)?\s*$/);
                if (match && match[1]) {
                    const cleanVal = match[1].trim();
                    if (isBase64(cleanVal)) {
                        return cleanVal;
                    }
                }
            }
            
            if (isBase64(textContent)) {
                return textContent;
            }
            
            return fileContent.toString('base64');
        }
    } catch (e) {
        console.warn(`⚠️ Warning: Error reading file at "${val}":`, e.message);
    }
    return val;
}


const rawArgs = process.argv.slice(2).map(a => a.toLowerCase());
const hasNv = rawArgs.includes('-nv') || rawArgs.includes('--nv') || rawArgs.includes('--no-version') || rawArgs.includes('nover') || rawArgs.includes('no-ver') || rawArgs.includes('-no') || rawArgs.includes('--no') || rawArgs.includes('no') || rawArgs.includes('-norev') || rawArgs.includes('--norev') || rawArgs.includes('norev');

const cleanArgs = rawArgs.filter(a => !a.startsWith('-') && a !== 'nover' && a !== 'no-ver' && a !== 'no' && a !== 'norev');
const rawTarget = cleanArgs[0] || '';
const rawType = cleanArgs[1] || '';

let argTarget = rawTarget;
let buildType = rawType;
if (rawTarget === 'apk' || rawTarget === 'aab' || rawTarget === 'bundle') {
    argTarget = 'android';
    if (rawTarget === 'aab' || rawTarget === 'bundle') buildType = 'bundle';
}
if (rawTarget === 'ipa') argTarget = 'ios';
const GITHUB_TOKEN = process.env.GITHUB_DEV_PAT;
const REPO = "firstryan-sbr/180spm"; 
const WORKFLOW_ID = "ios-build.yml";

async function run() {
    if (!argTarget) {
        console.log('\n❌ Error: Please specify target (ios or android)');
        console.log('💡 Usage: npx ota-manager build ios\n');
        process.exit(1);
    }

    syncBranding();

    const otaConfigPath = path.join(rootDir, 'ota-config.json');
    let strategy = 'github';
    let repoUrl = '';
    if (fs.existsSync(otaConfigPath)) {
        const otaConfig = JSON.parse(fs.readFileSync(otaConfigPath, 'utf8'));
        strategy = otaConfig.strategy || 'github';
        repoUrl = otaConfig[strategy]?.repo || '';
    }

    const otaReleasesDir = path.join(rootDir, 'ota-releases');
    if (repoUrl) {
        console.log(`📂 Preparing remote OTA repository to synchronize version & hash...`);
        const pat = process.env.GITHUB_DEV_PAT || process.env.GITLAB_DEV_PAT || '';
        const cloneRepo = repoUrl.endsWith('.git') ? repoUrl : repoUrl + '.git';
        const authRepo = cloneRepo.replace('https://', `https://${pat}@`);
        if (fs.existsSync(otaReleasesDir)) fs.rmSync(otaReleasesDir, { recursive: true, force: true });
        try {
            execSync(`git clone --depth 1 ${authRepo} "${otaReleasesDir}"`, { stdio: 'ignore' });
        } catch (e) {
            console.log('⚠️ Could not clone remote repo, falling back to existing manifest if available.');
        }
    }

    const manifestPath = path.join(otaReleasesDir, 'manifest.json');
    let previousVersion = process.env.PUBLIC_APP_VERSION_ANDROID || '0.1.9.0';
    let previousHash = null;
    if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        previousVersion = manifest.version || manifest.live?.version || previousVersion;
        previousHash = manifest.hash || manifest.live?.hash || null;
    }

    console.log('🏗️ Building project for Smart Diff Check...');
    const apiDir = path.join(rootDir, 'src', 'pages', 'api');
    const apiBackupDir = path.join(rootDir, 'src', '_api-backup');
    let apiHidden = false;
    if (fs.existsSync(apiDir)) {
        console.log('🙈 Hiding API routes (Using Robust Move)...');
        if (fs.existsSync(apiBackupDir)) fs.rmSync(apiBackupDir, { recursive: true, force: true });
        if (process.platform === 'win32') {
            try { execSync(`robocopy "${apiDir}" "${apiBackupDir}" /E /MOVE /NFL /NDL /NJH /NJS`, { stdio: 'ignore' }); } catch (e) { if (fs.existsSync(apiDir)) throw e; }
        } else {
            fs.renameSync(apiDir, apiBackupDir);
        }
        apiHidden = true;
    }
    try {
        execSync('npm run build', { stdio: 'inherit', cwd: rootDir, env: process.env });
    } finally {
        if (apiHidden && fs.existsSync(apiBackupDir)) {
            console.log('🐵 Restoring API routes...');
            if (process.platform === 'win32') {
                try { execSync(`robocopy "${apiBackupDir}" "${apiDir}" /E /MOVE /NFL /NDL /NJH /NJS`, { stdio: 'ignore' }); } catch (e) { if (fs.existsSync(apiBackupDir)) throw e; }
            } else {
                fs.renameSync(apiBackupDir, apiDir);
            }
        }
    }

    console.log('🧠 Calculating SHA-256 Hash of dist/ artifacts...');
    const distDir = path.join(rootDir, 'dist');
    const currentBuildHash = getDirHash(distDir);
    console.log(`🔑 Current Build Hash : ${currentBuildHash.substring(0, 16)}...`);
    if (previousHash) console.log(`🔒 Previous Release Hash: ${previousHash.substring(0, 16)}...`);

    let activeVersion = previousVersion;
    let isChanged = (!previousHash || previousHash !== currentBuildHash);

    if (hasNv) {
        activeVersion = process.env.PUBLIC_APP_VERSION || process.env.PUBLIC_APP_VERSION_ANDROID || previousVersion;
        console.log(`\n🛡️ [FLAG -nv DETECTED] Mempertahankan versi lokal saat ini: ${activeVersion} (No version increment)`);
    } else if (!isChanged) {
        console.log(`\nℹ️ [SMART DIFF CHECKER] No code changes detected in build artifacts.`);
        console.log(`📄 Version maintained at: ${previousVersion} (No version increment)`);
        
        const ext = (buildType === 'bundle' || buildType === 'aab') ? 'aab' : 'apk';
        const existingPath = argTarget === 'android' 
            ? path.join(rootDir, 'android', 'release', `180spm-${previousVersion}.${ext}`)
            : path.join(rootDir, 'ios', 'release', 'ios-build.zip');
            
        console.log(`📦 ${argTarget.toUpperCase()} file for this version is already available at:\n   👉 ${existingPath}`);
        
        const proceed = await confirm(`Do you want to force rebuild ${argTarget.toUpperCase()} anyway?`);
        if (!proceed) {
            console.log('\n❌ Build cancelled. Please use the existing file at the specified path.\n');
            process.exit(0);
        }
    } else {
        const parts = previousVersion.split('.');
        const lastIdx = parts.length - 1;
        const oldPart = parts[lastIdx];
        const oldLen = oldPart.length;
        parts[lastIdx] = (parseInt(oldPart) + 1).toString().padStart(oldLen, '0');
        const nextVersion = parts.join('.');
        
        console.log(`\n🔍 Code changes detected!`);
        console.log(`📈 Version will increment: ${previousVersion} -> ${nextVersion}`);
        
        const proceed = await confirm(`Do you want to proceed building ${argTarget.toUpperCase()} with the new version (${nextVersion})?`);
        if (!proceed) {
            console.log('\n❌ Build cancelled.\n');
            process.exit(0);
        }
        
        activeVersion = nextVersion;
        console.log(`📝 Updating .env & manifest to version ${activeVersion}...`);
        const envPath = path.join(rootDir, '.env');
        if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf8');
            envContent = envContent.replace(/PUBLIC_APP_VERSION_ANDROID=.*/, `PUBLIC_APP_VERSION_ANDROID=${activeVersion}`);
            envContent = envContent.replace(/PUBLIC_APP_VERSION_IOS=.*/, `PUBLIC_APP_VERSION_IOS=${activeVersion}`);
            if (envContent.includes('PUBLIC_APP_VERSION=')) {
                envContent = envContent.replace(/PUBLIC_APP_VERSION=.*/, `PUBLIC_APP_VERSION=${activeVersion}`);
            }
            fs.writeFileSync(envPath, envContent);
            process.env.PUBLIC_APP_VERSION = activeVersion;
        }
        const mainManifestPath = path.join(rootDir, 'src', 'data', 'update-data.json');
        if (fs.existsSync(mainManifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(mainManifestPath, 'utf8'));
            manifest.version = activeVersion;
            fs.writeFileSync(mainManifestPath, JSON.stringify(manifest, null, 2));
        }
        const pkgJsonPath = path.join(rootDir, 'package.json');
        if (fs.existsSync(pkgJsonPath)) {
            const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
            pkgJson.version = activeVersion;
            fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2));
        }
    }

    if (argTarget === 'ios') {
        await buildIos();
    } else if (argTarget === 'android') {
        await buildAndroid(activeVersion, buildType);
    } else {
        console.log(`❌ Error: Unknown target '${argTarget}'`);
        process.exit(1);
    }
}

async function buildIos() {
    if (!GITHUB_TOKEN) {
        console.log('❌ Error: GITHUB_DEV_PAT missing in .env');
        process.exit(1);
    }

    const activeWorkflowId = buildType === 'release' ? 'ios-release.yml' : 'ios-build.yml';
    const buildModeName = buildType === 'release' ? 'App Store Release' : 'Free Sideloading';
    console.log(`\n🍏 --- STARTING INTELLIGENT iOS BUILD [${buildModeName.toUpperCase()}] ---`);
    
    const branch = execSync('git branch --show-current').toString().trim();
    console.log(`🌿 Branch: ${branch}`);

    console.log('🔍 Checking for active builds on GitHub...');
    const activeRuns = await githubApi(`/repos/${REPO}/actions/runs?status=in_progress&branch=${branch}&workflow=${activeWorkflowId}`);
    const queuedRuns = await githubApi(`/repos/${REPO}/actions/runs?status=queued&branch=${branch}&workflow=${activeWorkflowId}`);
    
    let runId = null;
    if ((activeRuns.workflow_runs && activeRuns.workflow_runs.length > 0) || (queuedRuns.workflow_runs && queuedRuns.workflow_runs.length > 0)) {
        const existing = (activeRuns.workflow_runs && activeRuns.workflow_runs[0]) || (queuedRuns.workflow_runs && queuedRuns.workflow_runs[0]);
        runId = existing.id;
        console.log(`⚠️  Build already in progress (ID: ${runId}). Joining existing instance...`);
    } else {
        console.log('📦 Checking for changes to push...');
        try {
            execSync('git add .', { stdio: 'ignore' });
            const status = execSync('git status --porcelain').toString();

            let remoteName = 'origin';
            try {
                const remotes = execSync('git remote').toString().trim().split(/\s+/);
                if (!remotes.includes('origin')) {
                    if (remotes.includes('github')) {
                        remoteName = 'github';
                    } else if (remotes.length > 0 && remotes[0]) {
                        remoteName = remotes[0];
                    }
                }
            } catch (err) {}

            if (status) {
                console.log(`📤 Pushing changes to ${remoteName}...`);
                execSync('git commit -m "chore: automated build sync"', { stdio: 'ignore' });
                execSync(`git push ${remoteName} ${branch}`, { stdio: 'ignore' });
                console.log('✅ Changes pushed!');
                await sleep(2000);
            } else {
                console.log(`✅ No local file changes. Ensuring active branch ref is pushed to remote on ${remoteName}...`);
                execSync(`git push ${remoteName} ${branch}`, { stdio: 'ignore' });
            }
        } catch (e) {
            console.log('⚠️ Git push skipped or branch already up to date on remote.');
        }

        console.log('🚀 Triggering GitHub Action...');
        try {
            const payload = { ref: branch };
            payload.inputs = {
                channel: process.env.PUBLIC_APP_CHANNEL || 'training',
                api_url: process.env.PUBLIC_API_URL || '',
                github_ota_pat: process.env.PUBLIC_GITHUB_OTA_PAT || '',
                ota_update_url: process.env.PUBLIC_OTA_UPDATE_URL || ''
            };
            if (activeWorkflowId === 'ios-release.yml') {
                const certVal = process.env.APPLE_BUILD_CERTIFICATE_BASE64 || '';
                const provVal = process.env.APPLE_BUILD_PROVISION_PROFILE_BASE64 || '';
                const apiKeyVal = process.env.APP_STORE_CONNECT_API_KEY_BASE64 || '';

                payload.inputs.apple_build_certificate_base64 = getBase64OrFileContent(certVal);
                payload.inputs.apple_build_provision_profile_base64 = getBase64OrFileContent(provVal);
                payload.inputs.app_store_connect_api_key_base64 = getBase64OrFileContent(apiKeyVal);
                payload.inputs.app_store_connect_api_key_id = process.env.APP_STORE_CONNECT_API_KEY_ID || '';
                payload.inputs.app_store_connect_api_issuer = process.env.APP_STORE_CONNECT_API_ISSUER || '';
                payload.inputs.apple_p12_password = process.env.APPLE_P12_PASSWORD || '';
                payload.inputs.apple_keychain_password = process.env.APPLE_KEYCHAIN_PASSWORD || '';
            }
            await githubApi(`/repos/${REPO}/actions/workflows/${activeWorkflowId}/dispatches`, 'POST', payload);
            console.log('✅ Trigger Success! Waiting for run to start...');
        } catch (e) {
            console.error('❌ Failed to trigger build:', e.message);
            process.exit(1);
        }
    }

    let attempts = 0;
    while (!runId && attempts < 10) {
        await sleep(3000);
        const runs = await githubApi(`/repos/${REPO}/actions/runs?branch=${branch}&per_page=5`);
        if (runs.workflow_runs && runs.workflow_runs.length > 0) {
            const latest = runs.workflow_runs[0];
            if (latest.status !== 'completed') {
                runId = latest.id;
                console.log(`🆔 Run ID: ${runId}`);
            }
        }
        attempts++;
    }

    if (!runId) {
        console.log('❌ Could not find the started run. Please check GitHub Actions web UI.');
        process.exit(1);
    }

    console.log('⏳ Monitoring Progress (This may take 5-10 minutes)...');
    let status = 'queued';
    let startTime = Date.now();
    
    while (status !== 'completed') {
        await sleep(5000);
        const runData = await githubApi(`/repos/${REPO}/actions/runs/${runId}`);
        status = runData.status;
        const conclusion = runData.conclusion;
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        
        process.stdout.write(`\r🔄 Status: [${status.toUpperCase()}] | Time: ${elapsed}s ... `);

        if (status === 'completed') {
            console.log('\n');
            if (conclusion === 'success') {
                console.log(`✨ iOS BUILD SUCCESS [${buildModeName.toUpperCase()}]!`);
                await downloadArtifact(runId);
            } else {
                console.log(`❌ iOS BUILD FAILED (Conclusion: ${conclusion})`);
                console.log(`🔗 Log: https://github.com/${REPO}/actions/runs/${runId}`);
                process.exit(1);
            }
        }
    }
}

async function downloadArtifact(runId) {
    console.log('📥 Finding artifact to download...');
    const artifactsData = await githubApi(`/repos/${REPO}/actions/runs/${runId}/artifacts`);
    
    if (!artifactsData.artifacts || artifactsData.artifacts.length === 0) {
        console.log('❌ No artifacts found for this run.');
        return;
    }

    const artifact = artifactsData.artifacts[0];
    const targetDir = path.join(rootDir, 'ios', 'release');
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    
    const zipName = buildType === 'release' ? 'ios-release.zip' : 'ios-build.zip';
    const targetFile = path.join(targetDir, zipName);
    
    console.log(`📥 Downloading ${artifact.name} to ${targetFile}...`);
    
    try {
        execSync(`curl.exe -L -H "Authorization: token ${GITHUB_TOKEN}" -o "${targetFile}" "${artifact.archive_download_url}"`, { stdio: 'inherit' });
        console.log('\n✅ Download Complete!');
        console.log(`📦 Path: ${targetFile}`);
        if (buildType === 'release') {
            console.log('💡 Unzip the package to retrieve the signed "180spm-release.ipa".');
            console.log('💡 You can now upload this .ipa file directly to Apple TestFlight or App Store Connect.\n');
        } else {
            console.log('💡 Unzip and use Sideloadly to install on iPhone.\n');
        }
    } catch (e) {
        console.error('❌ Download failed:', e.message);
    }
}

async function buildAndroid(activeVersion, buildType) {
    console.log('\n🤖 --- STARTING LOCAL ANDROID BUILD ---');
    console.log('⚠️  Note: This requires Java JDK and Android Studio/SDK installed.');
    
    try {
        console.log('🔄 Syncing Capacitor Android...');
        execSync('npx cap sync android', { stdio: 'inherit', cwd: rootDir, env: process.env });

        const isBundle = buildType === 'bundle' || buildType === 'aab';
        const isRelease = isBundle || buildType === 'release';
        const task = isBundle ? 'bundleRelease' : (isRelease ? 'assembleRelease' : 'assembleDebug');
        const modeName = isBundle ? 'App Bundle (Release)' : (isRelease ? 'APK (Release)' : 'APK (Debug)');

        console.log(`☕ Running Gradle Build (${task})...`);
        const gradleCmd = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
        const androidDir = path.join(rootDir, 'android');
        
        execSync(`${gradleCmd} ${task}`, { stdio: 'inherit', cwd: androidDir });

        const targetDir = path.join(rootDir, 'android', 'release');
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        
        let sourcePath = '';
        const ext = isBundle ? 'aab' : 'apk';
        
        if (isBundle) {
            sourcePath = path.join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
        } else if (isRelease) {
            sourcePath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
        } else {
            sourcePath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
        }
        
        const finalFile = path.join(targetDir, `180spm-${activeVersion || 'debug'}.${ext}`);
        fs.copyFileSync(sourcePath, finalFile);

        console.log(`\n✅ ANDROID BUILD SUCCESS (${modeName})!`);
        console.log(`📦 Path: ${finalFile}\n`);
    } catch (e) {
        console.error('\n❌ Android Build Failed:', e.message);
        process.exit(1);
    }
}

function githubApi(endpoint, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: endpoint,
            method: method,
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'User-Agent': 'OTA-Manager-CLI',
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    return reject(new Error(`GitHub API Error: ${res.statusCode} - ${body}`));
                }
                try {
                    resolve(body ? JSON.parse(body) : {});
                } catch (e) {
                    resolve({});
                }
            });
        });

        req.on('error', (e) => reject(e));
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

function syncBranding() {
    const appName = process.env.PUBLIC_APP_NAME || '180spm';
    const appId = process.env.PUBLIC_APP_ID || 'com.cyclopedia.one_eighty_run';
    const appVer = process.env.PUBLIC_APP_VERSION || process.env.PUBLIC_APP_VERSION_ANDROID || '2.0.00';
    console.log(`✨ Syncing Branding & Version: [${appName} (${appId}) - ${appVer}]`);

    try {
        const androidStringsPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
        if (fs.existsSync(androidStringsPath)) {
            let content = fs.readFileSync(androidStringsPath, 'utf8');
            content = content.replace(/<string name="app_name">.*?<\/string>/, `<string name="app_name">${appName}<\/string>`);
            fs.writeFileSync(androidStringsPath, content);
        }

        const partsStr = appVer.split('.');
        let majorStr = partsStr[0] || '0';
        let minorStr = partsStr[1] || '0';
        let patchStr = partsStr[2] || '00';
        if (patchStr.length === 1) patchStr = '0' + patchStr;
        const versionCodeNum = parseInt(`${majorStr}${minorStr}${patchStr}`, 10) || 1;

        const buildGradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');
        if (fs.existsSync(buildGradlePath)) {
            let bgContent = fs.readFileSync(buildGradlePath, 'utf8');
            bgContent = bgContent.replace(/applicationId\s+".*?"/, `applicationId "${appId}"`);
            bgContent = bgContent.replace(/versionCode\s+\d+/, `versionCode ${versionCodeNum}`);
            bgContent = bgContent.replace(/versionName\s+".*?"/, `versionName "${appVer}"`);
            fs.writeFileSync(buildGradlePath, bgContent);
        }

        const iosPlistPath = path.join(rootDir, 'ios', 'App', 'App', 'Info.plist');
        if (fs.existsSync(iosPlistPath)) {
            let content = fs.readFileSync(iosPlistPath, 'utf8');
            content = content.replace(/<key>CFBundleDisplayName<\/key>\s*<string>.*?<\/string>/, `<key>CFBundleDisplayName<\/key>\n\t<string>${appName}<\/string>`);
            fs.writeFileSync(iosPlistPath, content);
        }

        const pbxprojPath = path.join(rootDir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
        if (fs.existsSync(pbxprojPath)) {
            let pbxContent = fs.readFileSync(pbxprojPath, 'utf8');
            pbxContent = pbxContent.replace(/PRODUCT_BUNDLE_IDENTIFIER = .*?;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${appId};`);
            pbxContent = pbxContent.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${versionCodeNum};`);
            pbxContent = pbxContent.replace(/MARKETING_VERSION = .*?;/g, `MARKETING_VERSION = ${appVer};`);
            fs.writeFileSync(pbxprojPath, pbxContent);
        }

        const iosCapConfig = path.join(rootDir, 'ios', 'App', 'App', 'capacitor.config.json');
        if (fs.existsSync(iosCapConfig)) {
            let capContent = fs.readFileSync(iosCapConfig, 'utf8');
            capContent = capContent.replace(/"appId":\s*".*?"/, `"appId": "${appId}"`);
            capContent = capContent.replace(/"appName":\s*".*?"/, `"appName": "${appName}"`);
            fs.writeFileSync(iosCapConfig, capContent);
        }

        const androidCapConfig = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'capacitor.config.json');
        if (fs.existsSync(androidCapConfig)) {
            let capContent = fs.readFileSync(androidCapConfig, 'utf8');
            capContent = capContent.replace(/"appId":\s*".*?"/, `"appId": "${appId}"`);
            capContent = capContent.replace(/"appName":\s*".*?"/, `"appName": "${appName}"`);
            fs.writeFileSync(androidCapConfig, capContent);
        }

        console.log(`✅ Branding & native versions synchronized (versionCode: ${versionCodeNum}).`);
    } catch (e) {
        console.error('⚠️ Warning: Failed to sync branding/version:', e.message);
    }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

run();
