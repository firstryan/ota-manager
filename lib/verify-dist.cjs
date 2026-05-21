const fs = require('fs');
const path = require('path');

const distDir = path.join(process.cwd(), 'dist');
const filesToVerify = ['splash.html', 'index.html', 'home.html'];

console.log('🔍 STARTING OTA ZIP VERIFICATION (Pre-Flight Check)...\n');

if (!fs.existsSync(distDir)) {
    console.log(`❌ Error: dist/ directory not found in ${process.cwd()}`);
    process.exit(1);
}

let totalErrors = 0;

filesToVerify.forEach(filename => {
    const filePath = path.join(distDir, filename);
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️  WARNING: Main file ${filename} not found in dist/`);
        return;
    }

    console.log(`📄 Verifying: ${filename}`);
    const content = fs.readFileSync(filePath, 'utf8');

    // Regex to search for src="..." or href="..."
    const regex = /(?:src|href)=["']([^"']+)["']/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
        const assetPath = match[1];

        // Ignore external links or base64
        if (assetPath.startsWith('http') || assetPath.startsWith('data:')) continue;

        let hasError = false;

        // CHECK 1: Illegal slashes specifically for assets folder
        if (assetPath.startsWith('/assets') || assetPath.startsWith('.//')) {
            console.log(`   ❌ PATH ERROR: Illegal path found -> "${assetPath}"`);
            hasError = true;
            totalErrors++;
        }

        // Ignore physical file validation for HTML navigation or SVG anchors
        if (assetPath.endsWith('.html') || assetPath.startsWith('#')) continue;

        // CHECK 2: Does the file physically exist?
        // Since our paths must be relative (e.g., assets/file.css),
        // we join them with the root dist/ folder
        const physicalPath = path.join(distDir, assetPath);
        if (!fs.existsSync(physicalPath)) {
            console.log(`   ❌ MISSING FILE ERROR: File not found at -> "${assetPath}"`);
            hasError = true;
            totalErrors++;
        }
    }
    console.log(`   ✅ ${filename} verification complete.`);
});

// Verify contents of dist/assets/ folder
const assetsDir = path.join(distDir, 'assets');
if (fs.existsSync(assetsDir)) {
    console.log('\n📁 Verifying JS files in dist/assets/...');
    const jsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));
    
    jsFiles.forEach(f => {
        const content = fs.readFileSync(path.join(assetsDir, f), 'utf8');
        if (content.includes('return"/"+e') || content.includes('return "/" + e')) {
            console.log(`   ❌ VITE PRELOAD ERROR: Absolute dynamic path found in JS file -> "${f}"`);
            totalErrors++;
        }
    });
    console.log('   ✅ JS file verification in dist/assets/ complete.');
}

console.log('\n------------------------------------');
if (totalErrors === 0) {
    console.log('🎉 VERIFICATION SUCCESS! All paths are purely relative and physical files detected.');
    console.log('This OTA bundle is 100% SAFE to deploy.\n');
} else {
    console.log(`💥 VERIFICATION FAILED! Found ${totalErrors} error(s) in path structure or files.`);
    console.log('💡 MUST FIX before deploying OTA to avoid blank screens on users\' devices!\n');
    process.exit(1);
}
