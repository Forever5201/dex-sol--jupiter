/**
 * Launcher主程序
 * 
 * 系统唯一入口点，负责：
 * 1. 解析命令行参数
 * 2. 加载配置文件
 * 3. 动态加载任务模块
 * 4. 管理任务生命周期
 * 
 * 参考设计文档2.1节
 */

import { loadConfig, validateConfig, loadGlobalConfig } from './config-loader';
import { loadTask, getAvailableTasks } from './task-loader';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Launcher配置
 */
interface LauncherConfig {
  launcher: {
    task: string;
  };
  task_configs: {
    [key: string]: string;
  };
  options: {
    auto_restart: boolean;
    max_restarts: number;
    restart_delay_seconds: number;
    health_check_on_start: boolean;
  };
}

/**
 * Launcher类
 */
export class Launcher {
  private launcherConfig: LauncherConfig;
  private taskConfig: any;
  private currentTask: any;
  private restartCount = 0;

  constructor(launcherConfigPath?: string) {
    // 加载launcher配置
    const configPath = launcherConfigPath || 'configs/launcher.toml';
    this.launcherConfig = loadConfig<LauncherConfig>(configPath);

    console.log('═══════════════════════════════════════');
    console.log('🚀 Solana Arbitrage Bot Launcher');
    console.log('═══════════════════════════════════════\n');
  }

  /**
   * 启动
   */
  async start(): Promise<void> {
    try {
      // 1. 显示配置信息
      this.printConfig();

      // 2. 环境检查
      await this.environmentCheck();

      // 3. 加载任务配置
      await this.loadTaskConfig();

      // 4. 验证配置
      this.validateTaskConfig();

      // 5. 加载并启动任务
      await this.startTask();

      // 6. 处理退出信号
      this.setupExitHandlers();

      console.log('\n✅ Launcher started successfully');
      console.log('Press Ctrl+C to stop\n');

    } catch (error: any) {
      console.error('\n❌ Launcher failed to start:', error.message);
      process.exit(1);
    }
  }

  /**
   * 打印配置信息
   */
  private printConfig(): void {
    const taskName = this.launcherConfig.launcher.task;
    const availableTasks = getAvailableTasks();

    console.log('📋 Configuration:');
    console.log(`   Task: ${taskName}`);
    console.log(`   Available tasks: ${availableTasks.join(', ')}`);
    console.log('');
  }

  /**
   * 环境检查
   */
  private async environmentCheck(): Promise<void> {
    console.log('🔍 Environment check...');

    // 检查Node.js版本
    const nodeVersion = process.version;
    console.log(`   Node.js: ${nodeVersion}`);

    // 检查全局配置
    try {
      loadGlobalConfig();
      console.log('   Global config: ✅');
    } catch (error: any) {
      console.error('   Global config: ❌', error.message);
      throw error;
    }

    console.log('');
  }

  /**
   * 加载任务配置
   */
  private async loadTaskConfig(): Promise<void> {
    const taskName = this.launcherConfig.launcher.task;
    const configPath = this.launcherConfig.task_configs[taskName];

    if (!configPath) {
      throw new Error(`No config path defined for task: ${taskName}`);
    }

    console.log(`📂 Loading task config: ${configPath}`);

    if (!existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

    this.taskConfig = loadConfig(configPath);
    console.log('   ✅ Config loaded\n');
  }

  /**
   * 验证任务配置
   */
  private validateTaskConfig(): void {
    console.log('✔️  Validating config...');

    const result = validateConfig(this.taskConfig);

    if (!result.valid) {
      console.error('\n❌ Configuration validation failed:\n');
      result.errors.forEach(error => {
        console.error(`   ${error}`);
      });
      console.error('');
      throw new Error('Invalid configuration');
    }

    console.log('   ✅ Config valid\n');
  }

  /**
   * 启动任务
   */
  private async startTask(): Promise<void> {
    const taskName = this.launcherConfig.launcher.task;

    console.log(`🎯 Loading task: ${taskName}...`);

    try {
      this.currentTask = await loadTask(taskName);
      console.log('   ✅ Task loaded\n');

      console.log(`▶️  Starting ${taskName}...\n`);
      await this.currentTask.start(this.taskConfig);

    } catch (error: any) {
      console.error(`❌ Failed to start task: ${error.message}`);
      
      // 自动重启逻辑
      if (this.shouldRestart()) {
        await this.restartTask();
      } else {
        throw error;
      }
    }
  }

  /**
   * 判断是否应该重启
   */
  private shouldRestart(): boolean {
    const options = this.launcherConfig.options;
    
    if (!options.auto_restart) {
      return false;
    }

    if (this.restartCount >= options.max_restarts) {
      console.error(`❌ Max restart attempts reached (${options.max_restarts})`);
      return false;
    }

    return true;
  }

  /**
   * 重启任务
   */
  private async restartTask(): Promise<void> {
    this.restartCount++;
    const delay = this.launcherConfig.options.restart_delay_seconds * 1000;

    console.log(`\n🔄 Restarting task in ${delay / 1000}s (attempt ${this.restartCount})...`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    await this.startTask();
  }

  /**
   * 停止
   */
  async stop(): Promise<void> {
    console.log('\n🛑 Stopping launcher...');

    if (this.currentTask) {
      try {
        await this.currentTask.stop();
        console.log('✅ Task stopped');
      } catch (error: any) {
        console.error('❌ Error stopping task:', error.message);
      }
    }

    console.log('✅ Launcher stopped\n');
  }

  /**
   * 设置退出处理
   */
  private setupExitHandlers(): void {
    const handleExit = async (signal: string) => {
      console.log(`\n\n📡 Received ${signal}`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => handleExit('SIGINT'));
    process.on('SIGTERM', () => handleExit('SIGTERM'));
  }
}

// ========================================
// CLI入口
// ========================================

async function main() {
  // 解析命令行参数
  const args = process.argv.slice(2);
  let configPath = 'configs/launcher.toml';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' || args[i] === '-c') {
      configPath = args[i + 1];
      break;
    }
  }

  // 创建并启动launcher
  const launcher = new Launcher(configPath);
  await launcher.start();
}

// 直接执行
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Launcher 类已经在第39行导出，这里不需要重复导出
// export { Launcher };
