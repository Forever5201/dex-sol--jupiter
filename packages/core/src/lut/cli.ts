#!/usr/bin/env node
/**
 * LUT命令行工具
 * 
 * 提供便捷的LUT管理命令
 */

import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { LUTManager } from './manager';
import { LUT_PRESETS, LUTPreset } from './presets';
import { KeypairManager } from '../solana/keypair';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * CLI配置
 */
interface CLIConfig {
  rpcUrl: string;
  keypairPath: string;
  network: 'mainnet-beta' | 'devnet' | 'testnet';
}

/**
 * 加载CLI配置
 */
function loadConfig(): CLIConfig {
  const configPath = resolve(process.cwd(), 'lut-cli-config.json');
  
  if (existsSync(configPath)) {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  }

  // 默认配置
  return {
    rpcUrl: clusterApiUrl('devnet'),
    keypairPath: './keypairs/wallet.json',
    network: 'devnet',
  };
}

/**
 * 加载密钥对（使用统一的KeypairManager）
 */
function loadKeypair(path: string): Keypair {
  const fullPath = resolve(process.cwd(), path);
  return KeypairManager.loadFromFile(fullPath);
}

/**
 * 创建LUT
 */
async function createLUT(args: string[]) {
  console.log('🔧 Creating new LUT...\n');

  const config = loadConfig();
  const connection = new Connection(config.rpcUrl);
  const payer = loadKeypair(config.keypairPath);
  const manager = new LUTManager(connection);

  const result = await manager.createLUT(payer);

  console.log('✅ LUT Created Successfully!\n');
  console.log(`Address: ${result.lutAddress.toBase58()}`);
  console.log(`Transaction: ${result.signature}\n`);

  // 保存到文件
  const lutConfig = {
    address: result.lutAddress.toBase58(),
    network: config.network,
    createdAt: new Date().toISOString(),
    signature: result.signature,
  };

  const configPath = resolve(process.cwd(), 'lut-config.json');
  writeFileSync(configPath, JSON.stringify(lutConfig, null, 2));

  console.log(`📝 Config saved to: ${configPath}`);
}

/**
 * 扩展LUT
 */
async function extendLUT(args: string[]) {
  const lutAddress = args[0];
  const presetName = args[1] || 'ARBITRAGE_BASE';

  if (!lutAddress) {
    console.error('❌ Usage: extend <lut_address> [preset_name]');
    process.exit(1);
  }

  console.log(`🔧 Extending LUT: ${lutAddress}\n`);

  const config = loadConfig();
  const connection = new Connection(config.rpcUrl);
  const payer = loadKeypair(config.keypairPath);
  const manager = new LUTManager(connection);

  // 获取预设
  const preset = LUT_PRESETS[presetName as keyof typeof LUT_PRESETS];
  if (!preset) {
    console.error(`❌ Unknown preset: ${presetName}`);
    console.log('Available presets:', Object.keys(LUT_PRESETS).join(', '));
    process.exit(1);
  }

  console.log(`Using preset: ${preset.name}`);
  console.log(`Addresses to add: ${preset.addresses.length}\n`);

  const result = await manager.extendLUT(
    new PublicKey(lutAddress),
    preset.addresses,
    payer
  );

  console.log(`\n✅ LUT Extended Successfully!`);
  console.log(`Addresses added: ${result.addressesAdded}`);
  console.log(`Transactions: ${result.signatures?.length}\n`);

  result.signatures?.forEach((sig, i) => {
    console.log(`Batch ${i + 1}: ${sig}`);
  });
}

/**
 * 查看LUT信息
 */
async function infoLUT(args: string[]) {
  const lutAddress = args[0];

  if (!lutAddress) {
    console.error('❌ Usage: info <lut_address>');
    process.exit(1);
  }

  const config = loadConfig();
  const connection = new Connection(config.rpcUrl);
  const manager = new LUTManager(connection);

  console.log(`📊 LUT Information\n`);
  console.log(`Address: ${lutAddress}\n`);

  const lut = await manager.getLUT(new PublicKey(lutAddress));

  if (!lut) {
    console.log('❌ LUT not found');
    return;
  }

  console.log(`Authority: ${lut.state.authority?.toBase58() || 'None (frozen)'}`);
  console.log(`Addresses: ${lut.state.addresses.length}`);
  console.log(`Deactivation Slot: ${lut.state.deactivationSlot.toString()}`);
  console.log(`Last Extended Slot: ${lut.state.lastExtendedSlot.toString()}\n`);

  console.log('📋 Addresses:');
  lut.state.addresses.forEach((addr, i) => {
    console.log(`  ${i}: ${addr.toBase58()}`);
  });
}

/**
 * 冻结LUT
 */
async function freezeLUT(args: string[]) {
  const lutAddress = args[0];

  if (!lutAddress) {
    console.error('❌ Usage: freeze <lut_address>');
    process.exit(1);
  }

  console.log(`🔒 Freezing LUT: ${lutAddress}\n`);

  const config = loadConfig();
  const connection = new Connection(config.rpcUrl);
  const payer = loadKeypair(config.keypairPath);
  const manager = new LUTManager(connection);

  const signature = await manager.freezeLUT(
    new PublicKey(lutAddress),
    payer,
    payer
  );

  console.log(`✅ LUT Frozen Successfully!`);
  console.log(`Transaction: ${signature}`);
}

/**
 * 关闭LUT
 */
async function closeLUT(args: string[]) {
  const lutAddress = args[0];

  if (!lutAddress) {
    console.error('❌ Usage: close <lut_address>');
    process.exit(1);
  }

  console.log(`🗑️  Closing LUT: ${lutAddress}\n`);

  const config = loadConfig();
  const connection = new Connection(config.rpcUrl);
  const payer = loadKeypair(config.keypairPath);
  const manager = new LUTManager(connection);

  const signature = await manager.closeLUT(
    new PublicKey(lutAddress),
    payer,
    payer.publicKey,
    payer
  );

  console.log(`✅ LUT Closed Successfully!`);
  console.log(`Transaction: ${signature}`);
}

/**
 * 列出预设
 */
function listPresets() {
  console.log('📋 Available LUT Presets:\n');

  Object.entries(LUT_PRESETS).forEach(([key, preset]) => {
    console.log(`${key}:`);
    console.log(`  Name: ${preset.name}`);
    console.log(`  Description: ${preset.description}`);
    console.log(`  Addresses: ${preset.addresses.length}\n`);
  });
}

/**
 * 显示帮助
 */
function showHelp() {
  console.log(`
╔═══════════════════════════════════════╗
║   LUT Manager CLI                     ║
╚═══════════════════════════════════════╝

Commands:

  create
    Create a new LUT
    
  extend <lut_address> [preset_name]
    Extend LUT with addresses from preset
    Default preset: ARBITRAGE_BASE
    
  info <lut_address>
    Show LUT information
    
  freeze <lut_address>
    Freeze LUT (remove authority)
    
  close <lut_address>
    Close LUT and reclaim rent
    
  presets
    List available presets
    
  help
    Show this help message

Examples:

  # Create new LUT
  npm run lut create
  
  # Extend with base arbitrage accounts
  npm run lut extend <address> ARBITRAGE_BASE
  
  # View LUT info
  npm run lut info <address>
  
  # List presets
  npm run lut presets

Configuration:

  Create lut-cli-config.json in your project root:
  {
    "rpcUrl": "https://api.devnet.solana.com",
    "keypairPath": "./keypairs/wallet.json",
    "network": "devnet"
  }
`);
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'create':
        await createLUT(args.slice(1));
        break;
      case 'extend':
        await extendLUT(args.slice(1));
        break;
      case 'info':
        await infoLUT(args.slice(1));
        break;
      case 'freeze':
        await freezeLUT(args.slice(1));
        break;
      case 'close':
        await closeLUT(args.slice(1));
        break;
      case 'presets':
        listPresets();
        break;
      case 'help':
      default:
        showHelp();
        break;
    }
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

// 运行CLI
if (require.main === module) {
  main();
}

export { main as runLUTCLI };
