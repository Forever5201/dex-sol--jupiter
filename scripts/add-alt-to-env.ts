/**
 * 将 ALT 地址添加到 .env 文件
 */
import fs from 'fs';
import path from 'path';

const ALT_ADDRESS = 'Eq5wAtcD2uwGus2Y3RdEPJDD96g8ndpM17Yd99XxmM4S';

console.log('='.repeat(60));
console.log('添加 ALT 地址到 .env 文件');
console.log('='.repeat(60));
console.log('');

const envPath = path.join(process.cwd(), '.env');

let envContent = '';
if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf-8');
}

const envLines = envContent.split('\n');
let found = false;
const newLines = envLines.map(line => {
  if (line.startsWith('JUPITER_LEND_ALT_ADDRESS=')) {
    found = true;
    return `JUPITER_LEND_ALT_ADDRESS=${ALT_ADDRESS}`;
  }
  return line;
});

if (!found) {
  // 如果不存在，添加到文件末尾
  if (newLines.length > 0 && newLines[newLines.length - 1] !== '') {
    newLines.push('');
  }
  newLines.push(`JUPITER_LEND_ALT_ADDRESS=${ALT_ADDRESS}`);
}

fs.writeFileSync(envPath, newLines.join('\n'));

console.log('✅ ALT 地址已添加到 .env 文件');
console.log('');
console.log('ALT 信息:');
console.log(`   地址: ${ALT_ADDRESS}`);
console.log(`   链接: https://solscan.io/account/${ALT_ADDRESS}`);
console.log('');
console.log('现在可以启动机器人了:');
console.log('   pnpm start:flashloan --config=configs/flashloan-serverchan.toml');
console.log('');

