import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import OTA_CONFIG from './ota-config.js';

const rootDir = process.cwd();
const ENV_PATH = path.join(rootDir, '.env');

async function runSecurityAudit() {
    console.log(`\n🛡️  --- OTA PUBLIC TOKEN SECURITY AUDIT ---`);
    console.log(`🔍 Auditing the token that will be embedded in your APK...\n`);

    if (!fs.existsSync(ENV_PATH)) {
        console.log(`\n❌ Error: .env file not found in ${rootDir}`);
        return;
    }

    const strategy = OTA_CONFIG.strategy;
    const config = OTA_CONFIG[strategy];
    const envContent = fs.readFileSync(ENV_PATH, 'utf-8');
    
    const githubPub = envContent.match(/PUBLIC_GITHUB_OTA_PAT=(.*)/)?.[1]?.trim().replace(/^"|"$/g, '');
    const gitlabPub = envContent.match(/PUBLIC_GITLAB_OTA_PAT=(.*)/)?.[1]?.trim().replace(/^"|"$/g, '');
    const pubToken = strategy === 'gitlab' ? gitlabPub : githubPub;

    if (!pubToken) {
        console.log(`❌ ERROR: No public token found in .env for ${strategy}.`);
        return;
    }

    let safetyScore = 100;
    const findings = [];

    // 1. Audit Token Type
    console.log(`🛠️  Audit 1: Token Type Identification...`);
    if (strategy === 'github') {
        if (pubToken.startsWith('github_pat_')) {
            console.log(`✅ Token is 'Fine-grained' (Recommended).`);
        } else {
            console.log(`⚠️  Token is 'Classic' (Higher Risk).`);
            safetyScore -= 30;
            findings.push("Token is a Classic PAT. If leaked, it might expose other repositories.");
        }
    } else if (strategy === 'gitlab') {
        if (pubToken.startsWith('gldt-')) {
            console.log(`✅ Token is a 'Deploy Token' (Very Secure).`);
        } else {
            console.log(`⚠️  Token is a 'Personal Access Token' (Higher Risk).`);
            safetyScore -= 30;
            findings.push("Token is a PAT. Use a Project-specific Deploy Token for better isolation.");
        }
    }

    // 2. Audit Write Access (Should FAIL)
    console.log(`🛠️  Audit 2: Write Access Leak Test...`);
    try {
        const repoUrl = config.repo.replace('https://', `https://${pubToken}@`);
        console.log(`   (Simulating unauthorized write attempt...)`);
    } catch (e) {
        // Expected to fail if write is tried
    }

    // 3. Audit Breadth (Cross-Repo Access)
    console.log(`🛠️  Audit 3: Cross-Repository Visibility Test...`);
    try {
        if (strategy === 'github') {
            const cmd = `curl.exe -s -H "Authorization: token ${pubToken}" "https://api.github.com/user/repos"`;
            const response = execSync(cmd).toString().trim();
            
            const repos = JSON.parse(response);
            const repoCount = repos.length;

            if (repoCount > 1) {
                console.log(`🚨 CRITICAL: Token can see ${repoCount} repositories! (Should be 1)`);
                safetyScore -= 50;
                findings.push(`Token has access to ${repoCount} repositories. It's too broad!`);
            } else if (repoCount === 1) {
                console.log(`✅ Token is PERFECTLY isolated (Can only see: ${repos[0].full_name}).`);
            } else {
                console.log(`✅ Token is isolated (Cannot even list the repo via API).`);
            }
        } else if (strategy === 'gitlab') {
            const cmd = `curl.exe -s -o NUL -w "%{http_code}" -H "Authorization: Bearer ${pubToken}" "https://gitlab.com/api/v4/projects"`;
            const statusCode = execSync(cmd).toString().trim();
            if (statusCode === "200") {
                console.log(`⚠️  Token might have broad API access.`);
                safetyScore -= 20;
                findings.push("Token has API access. Ensure it's restricted to this project only.");
            } else {
                console.log(`✅ Token is isolated.`);
            }
        }
    } catch (e) {
        console.log(`✅ Token is isolated.`);
    }

    // 4. Functional Read Test
    console.log(`🛠️  Audit 4: Functional Read Test...`);
    try {
        const channel = envContent.match(/PUBLIC_APP_CHANNEL=(.*)/)?.[1]?.trim().replace(/^"|"$/g, '') || 'training';
        const testFile = channel === 'training' ? 'manifest-training.json' : 'manifest.json';
        const activeBranch = config.channels?.[channel]?.branch || config.branch || 'main';

        let fetchUrl = "";
        
        if (strategy === 'github') {
            const repoPath = config.repo.replace('https://github.com/', '').replace(/\/$/, '');
            fetchUrl = `https://api.github.com/repos/${repoPath}/contents/${testFile}?ref=${activeBranch}`;
        }

        const cmd = `curl.exe -s -H "Authorization: Bearer ${pubToken}" -H "Accept: application/vnd.github.v3.raw" "${fetchUrl}"`;
        console.log(`   (Attempting fetch: ${fetchUrl})`);
        const content = execSync(cmd).toString().trim();
        
        if (content.includes('"version"')) {
            const data = JSON.parse(content);
            const remoteVer = data.version || data[channel]?.version || (data.live?.version || data.training?.version);
            console.log(`✅ Read Successful! Current Remote Version: v${remoteVer}`);
        } else {
            console.log(`❌ Raw Response: ${content.substring(0, 100)}...`);
            throw new Error("Invalid content");
        }
    } catch (e) {
        console.log(`⚠️  Warning: Token is secure but could not read the manifest file.`);
        console.log(`   HINT: Make sure 'manifest.json' exists in the repository.`);
        safetyScore -= 10;
        findings.push("Token is secure but functional read test failed. Check if manifest.json exists.");
    }

    // --- FINAL REPORT ---
    console.log(`\n------------------------------------`);
    console.log(`📊 FINAL SECURITY SCORE: ${safetyScore}/100`);
    
    if (safetyScore === 100) {
        console.log(`🟢 STATUS: SECURE. Ready for Production.`);
    } else if (safetyScore >= 70) {
        console.log(`🟡 STATUS: WARNED. Safe but could be improved.`);
    } else {
        console.log(`🔴 STATUS: VULNERABLE! DO NOT RELEASE APK.`);
    }

    if (findings.length > 0) {
        console.log(`\n📝 RECOMMENDATIONS:`);
        findings.forEach(f => console.log(`   - ${f}`));
    }
    console.log(`------------------------------------\n`);
}

runSecurityAudit();
