import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'fs';
import path from 'path';
import * as toml from 'toml';

loadEnv();

const args = process.argv.slice(2);

function resolveConfigPath(): string | undefined {
  let configPath = args.find((arg) => arg.startsWith('--config='))?.split('=')[1];

  if (!configPath && args.length > 0 && !args[0].startsWith('--')) {
    configPath = args[0];
  }

  if (!configPath) {
    configPath = 'configs/flashloan-dryrun.toml';
  }

  return path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
}

function applyProxyFromConfig(configPath: string | undefined) {
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
    return;
  }

  if (!configPath) {
    return;
  }

  try {
    const fileContent = readFileSync(configPath, 'utf-8');
    const config = toml.parse(fileContent);
    const proxyUrl: string | undefined = config.network?.proxy_url || config.network?.proxy || config.network?.https_proxy;

    if (proxyUrl) {
      process.env.HTTPS_PROXY = proxyUrl;
      process.env.HTTP_PROXY = proxyUrl;
      process.env.WS_PROXY = proxyUrl;
      console.log(`🔧 [Bootstrap] Applied proxy from config: ${proxyUrl}`);
    }
  } catch (error) {
    console.warn(`⚠️  [Bootstrap] Failed to read proxy configuration from ${configPath}:`, (error as Error).message);
  }
}

const resolvedConfigPath = resolveConfigPath();
applyProxyFromConfig(resolvedConfigPath);

async function bootstrap() {
  const module = await import('./flashloan-bot');
  if (typeof module.main === 'function') {
    await module.main();
  }
}

bootstrap().catch((error) => {
  console.error('❌ Flashloan bootstrap failed:', error);
  process.exit(1);
});


