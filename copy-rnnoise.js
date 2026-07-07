const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'node_modules', '@timephy', 'rnnoise-wasm', 'dist');
const destDir = path.join(__dirname, 'public', 'rnnoise-wasm');

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

try {
  copyRecursiveSync(srcDir, destDir);
  console.log('Successfully copied rnnoise-wasm assets to public/rnnoise-wasm');

  // Fix extensionless imports inside NoiseSuppressorWorklet.js for native browser ES modules resolution
  const workletPath = path.join(destDir, 'NoiseSuppressorWorklet.js');
  if (fs.existsSync(workletPath)) {
    let content = fs.readFileSync(workletPath, 'utf8');
    content = content.replace(/import "\.\/polyfills"/g, 'import "./polyfills.js"');
    content = content.replace(/from "\.\/RnnoiseProcessor"/g, 'from "./RnnoiseProcessor.js"');
    content = content.replace(/from "\.\/generated\/rnnoise-sync"/g, 'from "./generated/rnnoise-sync.js"');
    content = content.replace(/from "\.\/index"/g, 'from "./index.js"');
    content = content.replace(/from "\.\/math"/g, 'from "./math.js"');
    fs.writeFileSync(workletPath, content, 'utf8');
    console.log('Successfully patched NoiseSuppressorWorklet.js imports with .js extensions');
  }
} catch (e) {
  console.error('Error copying/patching rnnoise-wasm assets:', e);
}
