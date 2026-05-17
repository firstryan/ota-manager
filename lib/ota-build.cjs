const { execSync } from 'child_process';
const fs = require('fs');
const path = require('path');
const https = require('https');

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

const argTarget = process.argv[2]; // 'ios' or 'android'
const GITHUB_TOKEN = process.env.GITHUB_DEV_PAT;
const REPO = "firstryan-sbr/180spm"; 
const WORKFLOW_ID = "ios-build.yml";

async function run() {
    if (!argTarget) {
        console.log('\n❌ Error: Please specify target (ios or android)');
        console.log('💡 Usage: npx ota-updates build ios\n');
        process.exit(1);
    }

    syncBranding();

    if (argTarget === 'ios') {
        await buildIos();
    } else if (argTarget === 'android') {
        await buildAndroid();
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

    console.log('\n🍏 --- STARTING INTELLIGENT iOS BUILD ---');
    
    const branch = execSync('git branch --show-current').toString().trim();
    console.log(`🌿 Branch: ${branch}`);

    console.log('🔍 Checking for active builds on GitHub...');
    const activeRuns = await githubApi(`/repos/${REPO}/actions/runs?status=in_progress&branch=${branch}&workflow=${WORKFLOW_ID}`);
    const queuedRuns = await githubApi(`/repos/${REPO}/actions/runs?status=queued&branch=${branch}&workflow=${WORKFLOW_ID}`);
    
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
            if (status) {
                console.log('📤 Pushing changes to GitHub...');
                execSync('git commit -m "chore: automated build sync"', { stdio: 'ignore' });
                execSync('git push origin development', { stdio: 'ignore' });
                console.log('✅ Changes pushed! Triggering new build...');
                await sleep(2000);
            } else {
                console.log('✅ No local changes. Checking if we need to trigger manually...');
            }
        } catch (e) {
            console.log('⚠️ Git push skipped (maybe no changes).');
        }

        console.log('🚀 Triggering GitHub Action...');
        try {
            await githubApi(`/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`, 'POST', {
                ref: branch
            });
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
                console.log('✨ iOS BUILD SUCCESS!');
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
    
    const targetFile = path.join(targetDir, 'ios-build.zip');
    
    console.log(`📥 Downloading ${artifact.name} to ${targetFile}...`);
    
    try {
        execSync(`curl.exe -L -H "Authorization: token ${GITHUB_TOKEN}" -o "${targetFile}" "${artifact.archive_download_url}"`, { stdio: 'inherit' });
        console.log('\n✅ Download Complete!');
        console.log(`📦 Path: ${targetFile}`);
        console.log('💡 Unzip and use Sideloadly to install on iPhone.\n');
    } catch (e) {
        console.error('❌ Download failed:', e.message);
    }
}

async function buildAndroid() {
    console.log('\n🤖 --- STARTING LOCAL ANDROID BUILD ---');
    console.log('⚠️  Note: This requires Java JDK and Android Studio/SDK installed.');
    
    try {
        console.log('🏗️ Building Astro & Syncing Capacitor...');
        
        const apiDir = path.join(rootDir, 'src', 'pages', 'api');
        const apiBackupDir = path.join(rootDir, 'src', '_api-backup');
        let apiHidden = false;

        if (fs.existsSync(apiDir)) {
            console.log('🙈 Hiding API routes to allow static build...');
            if (fs.existsSync(apiBackupDir)) fs.rmSync(apiBackupDir, { recursive: true, force: true });
            fs.renameSync(apiDir, apiBackupDir);
            apiHidden = true;
        }

        try {
            execSync('npm run build', { stdio: 'inherit', cwd: rootDir, env: process.env });
        } finally {
            if (apiHidden && fs.existsSync(apiBackupDir)) {
                console.log('🐵 Restoring API routes...');
                fs.renameSync(apiBackupDir, apiDir);
            }
        }

        execSync('npx cap sync android', { stdio: 'inherit', cwd: rootDir, env: process.env });

        console.log('☕ Running Gradle Build (AssembleDebug)...');
        const gradleCmd = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
        const androidDir = path.join(rootDir, 'android');
        
        execSync(`${gradleCmd} assembleDebug`, { stdio: 'inherit', cwd: androidDir });

        const apkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
        const targetDir = path.join(rootDir, 'android', 'release');
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        
        const finalApk = path.join(targetDir, `180spm-v${process.env.PUBLIC_APP_VERSION || 'debug'}.apk`);
        fs.copyFileSync(apkPath, finalApk);

        console.log('\n✅ ANDROID BUILD SUCCESS!');
        console.log(`📦 Path: ${finalApk}\n`);
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
    console.log(`✨ Syncing Branding: [${appName}]`);

    try {
        const androidStringsPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
        if (fs.existsSync(androidStringsPath)) {
            let content = fs.readFileSync(androidStringsPath, 'utf8');
            content = content.replace(/<string name="app_name">.*?<\/string>/, `<string name="app_name">${appName}<\/string>`);
            fs.writeFileSync(androidStringsPath, content);
        }

        const iosPlistPath = path.join(rootDir, 'ios', 'App', 'App', 'Info.plist');
        if (fs.existsSync(iosPlistPath)) {
            let content = fs.readFileSync(iosPlistPath, 'utf8');
            content = content.replace(/<key>CFBundleDisplayName<\/key>\s*<string>.*?<\/string>/, `<key>CFBundleDisplayName<\/key>\n\t<string>${appName}<\/string>`);
            fs.writeFileSync(iosPlistPath, content);
        }
        console.log('✅ Branding synchronized across platforms.');
    } catch (e) {
        console.error('⚠️ Warning: Failed to sync branding:', e.message);
    }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

run();
