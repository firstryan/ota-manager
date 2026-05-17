const fs = require('fs');
const path = require('path');

const distDir = path.join(process.cwd(), 'dist');
const filesToVerify = ['splash.html', 'index.html', 'home.html'];

console.log('🔍 MEMULAI VERIFIKASI OTA ZIP (Pre-Flight Check)...\n');

if (!fs.existsSync(distDir)) {
    console.log(`❌ Error: dist/ directory not found in ${process.cwd()}`);
    process.exit(1);
}

let totalErrors = 0;

filesToVerify.forEach(filename => {
    const filePath = path.join(distDir, filename);
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️  WARNING: File utama ${filename} tidak ditemukan di dist/`);
        return;
    }

    console.log(`📄 Memeriksa: ${filename}`);
    const content = fs.readFileSync(filePath, 'utf8');

    // Regex untuk mencari src="..." atau href="..."
    const regex = /(?:src|href)=["']([^"']+)["']/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
        const assetPath = match[1];

        // Abaikan link eksternal atau base64
        if (assetPath.startsWith('http') || assetPath.startsWith('data:')) continue;

        let hasError = false;

        // CEK 1: Garis Miring Ilegal khusus untuk folder assets
        if (assetPath.startsWith('/assets') || assetPath.startsWith('.//')) {
            console.log(`   ❌ ERROR JALUR: Ditemukan path ilegal -> "${assetPath}"`);
            hasError = true;
            totalErrors++;
        }

        // Abaikan validasi file fisik untuk navigasi HTML atau anchor SVG
        if (assetPath.endsWith('.html') || assetPath.startsWith('#')) continue;

        // CEK 2: Apakah filenya benar-benar ada secara fisik?
        // Karena path kita harusnya relatif (misal: assets/file.css), 
        // kita gabungkan dengan root folder dist/
        const physicalPath = path.join(distDir, assetPath);
        if (!fs.existsSync(physicalPath)) {
            console.log(`   ❌ ERROR FILE HILANG: File tidak ditemukan di -> "${assetPath}"`);
            hasError = true;
            totalErrors++;
        }
    }
    console.log(`   ✅ ${filename} selesai diperiksa.`);
});

// Verifikasi isi folder dist/assets/
const assetsDir = path.join(distDir, 'assets');
if (fs.existsSync(assetsDir)) {
    console.log('\n📁 Memeriksa file JS di folder dist/assets/...');
    const jsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));
    
    jsFiles.forEach(f => {
        const content = fs.readFileSync(path.join(assetsDir, f), 'utf8');
        if (content.includes('return"/"+e') || content.includes('return "/" + e')) {
            console.log(`   ❌ ERROR VITE PRELOAD: Ditemukan path absolut di file JS -> "${f}"`);
            totalErrors++;
        }
    });
    console.log('   ✅ Verifikasi file JS di dist/assets/ selesai.');
}

console.log('\n------------------------------------');
if (totalErrors === 0) {
    console.log('🎉 VERIFIKASI SUKSES! Semua path relatif murni dan file fisik terdeteksi.');
    console.log('Bungkusan OTA ini 100% AMAN untuk dikirim.\n');
} else {
    console.log(`💥 VERIFIKASI GAGAL! Ditemukan ${totalErrors} error pada struktur path atau file.`);
    console.log('💡 WAJIB PERBAIKI sebelum mengirim OTA untuk menghindari blank screen di HP user!\n');
    process.exit(1);
}
