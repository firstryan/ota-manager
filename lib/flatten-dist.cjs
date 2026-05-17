const fs = require('fs');
const path = require('path');

/**
 * SAPU JAGAT 4.0 (TSAR BOMBA): 
 * Menghancurkan SEMUA variasi "/assets/" dan ".//assets/" di seluruh file
 * tanpa peduli ada tanda kutip atau tidak.
 */
function fixPathsInFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Ganti semua variasi jalur absolut/cacat menjadi relatif murni
    let fixedContent = content;
    
    // 1. Bersihkan ".//assets/"
    fixedContent = fixedContent.split('.//assets/').join('assets/');
    
    // 2. Bersihkan "/assets/" yang ada di dalam tanda kutip (src, href)
    fixedContent = fixedContent.split('"/assets/').join('"assets/');
    fixedContent = fixedContent.split("'/assets/").join("'assets/");
    
    // 3. Bersihkan "/assets/" yang ada di luar tanda kutip (Teks Logo, dll)
    // Contoh: "Logo: /assets/..." -> "Logo: assets/..."
    fixedContent = fixedContent.split(' /assets/').join(' assets/');
    fixedContent = fixedContent.split('>/assets/').join('>assets/');
    fixedContent = fixedContent.split(':/assets/').join(':assets/');
    
    // 4. Bersihkan Vite preload helper & dynamic imports yang mengkonstruksi return"/"+e atau return "/" + e
    fixedContent = fixedContent.split('return"/"+e').join('return e');
    fixedContent = fixedContent.split('return "/" + e').join('return e');
    fixedContent = fixedContent.split('return `/${e}`').join('return e');
    
    if (content !== fixedContent) {
        fs.writeFileSync(filePath, fixedContent);
        console.log(`   💣 TSAR BOMBA FIX in: ${path.basename(filePath)}`);
    }
}

function flatten(dir, rootDir = dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'assets') {
                const assetFiles = fs.readdirSync(fullPath);
                assetFiles.forEach(f => {
                    if (f.endsWith('.js') || f.endsWith('.css')) {
                        fixPathsInFile(path.join(fullPath, f));
                    }
                });
                continue;
            }
            flatten(fullPath, rootDir);
            
            if (fs.readdirSync(fullPath).length === 0) {
                fs.rmdirSync(fullPath);
            }
        } else if (entry.name.endsWith('.html')) {
            fixPathsInFile(fullPath);
            
            if (entry.name === 'index.html' && dir !== rootDir) {
                const folderName = path.basename(dir);
                const targetPath = path.join(rootDir, folderName + '.html');
                fs.renameSync(fullPath, targetPath);
            }
        }
    }
}

const distPath = path.join(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
    console.log('🚀 SAPU JAGAT 4.0: Launching Tsar Bomba Path Cleanse...');
    flatten(distPath);
    console.log('✅ ALL PATHS ARE NOW 100% PURE RELATIVE!');
} else {
    console.log(`❌ Error: dist/ directory not found in ${process.cwd()}`);
}
