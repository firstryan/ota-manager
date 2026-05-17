import fs from 'fs';
import path from 'path';

const configPath = path.join(process.cwd(), 'ota-config.json');

let data = { strategy: 'github', configs: {} };
if (fs.existsSync(configPath)) {
    try {
        const rawData = fs.readFileSync(configPath, 'utf-8');
        data = JSON.parse(rawData);
    } catch (e) {
        console.warn('⚠️ Warning: ota-config.json is invalid or corrupted.');
    }
}

export default {
    strategy: data.strategy,
    ...data.configs
};
