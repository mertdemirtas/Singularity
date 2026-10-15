'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { version } = require('../package.json');
const directory = path.resolve(__dirname, '../release');
const files = fs.readdirSync(directory);
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Stable releases need a major.minor.patch version');
if (process.platform === 'darwin') {
  const archive = `Singularity-${version}-mac-${process.arch}.zip`;
  const bytes = fs.readFileSync(path.join(directory, archive));
  const key = process.env.SPARKLE_PRIVATE_KEY;
  if (!key) throw new Error('SPARKLE_PRIVATE_KEY is required to authenticate macOS updates');
  const publicKey = crypto.createPublicKey(crypto.createPrivateKey(key)).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  if (publicKey !== require('../assets/update-key.json').sparklePublicKey) throw new Error('macOS update signing key does not match the app');
  const signature = crypto.sign(null, bytes, key).toString('base64');
  fs.writeFileSync(path.join(directory, `appcast-${process.arch}.xml`), `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Singularity</title>
<item><title>Singularity ${version}</title><sparkle:version>${version}</sparkle:version><sparkle:shortVersionString>${version}</sparkle:shortVersionString>
<sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
<enclosure url="https://github.com/mertdemirtas/Singularity/releases/download/v${version}/${archive}" sparkle:edSignature="${signature}" length="${bytes.length}" type="application/octet-stream"/>
</item></channel></rss>\n`);
}
const artifacts = fs.readdirSync(directory).filter(file => /\.(exe|dmg|zip|deb|yml|xml|blockmap)$/.test(file) && !file.startsWith('builder-'));
const checksums = artifacts.map(file => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex')}  ${file}`);
fs.writeFileSync(path.join(directory, `SHA256SUMS-${process.platform}-${process.arch}.txt`), checksums.join('\n') + '\n');
console.log('Release metadata and checksums generated.');
