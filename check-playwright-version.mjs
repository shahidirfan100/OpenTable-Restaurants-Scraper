// Playwright version check - ensures package.json matches Docker base image
import { readFileSync } from 'fs';

const EXPECTED_PLAYWRIGHT_VERSION = '1.56.1';
const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
const actualVersion = packageJson.dependencies?.playwright || packageJson.devDependencies?.playwright;

if (!actualVersion) {
    console.error('ERROR: playwright not found in package.json dependencies');
    process.exit(1);
}

const cleanVersion = actualVersion.replace(/[\^~>=<]/g, '');

if (cleanVersion !== EXPECTED_PLAYWRIGHT_VERSION) {
    console.error(`ERROR: Playwright version mismatch!`);
    console.error(`  Expected: ${EXPECTED_PLAYWRIGHT_VERSION}`);
    console.error(`  Found: ${cleanVersion}`);
    console.error(`  Update package.json to use playwright version ${EXPECTED_PLAYWRIGHT_VERSION}`);
    process.exit(1);
}

console.log(`✓ Playwright version ${cleanVersion} matches Docker base image`);
