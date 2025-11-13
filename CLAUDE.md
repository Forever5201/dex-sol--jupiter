# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a professional-grade Solana DEX arbitrage bot system with a comprehensive economic model, flashloan integration, and MEV protection. The system consists of multiple packages working together to discover, analyze, and execute arbitrage opportunities on Solana DEXs.

## Build & Test Commands

```bash
# Build all packages
npm run build

# Clean build artifacts
npm run clean

# Run tests
npm run test                    # Run all tests without coverage
npm run test:coverage           # Run with coverage
npm run test:unit               # Unit tests only
npm run test:integration        # Integration tests only
npm run test:performance        # Performance tests (60s timeout)
npm run test:benchmark          # Benchmark tests
npm run test:stress             # Stress tests (60s timeout)
npm run test:watch              # Watch mode

# Development
npm run dev                     # Run core package in dev mode

# Utilities
npm run cost-sim                # Cost simulator tool
npm run jito-monitor            # Monitor Jito tip market
npm run demo                    # Economics demo
npm run test-jupiter            # Test Jupiter swap
```

## Bot Startup Commands

```bash
# Onchain Bot (scans blockchain directly)
npm run start:onchain-bot       # Development mode
npm run start:onchain-bot:prod  # Production mode

# Jupiter Bot (uses Jupiter API)
npm run start:flashloan         # Development mode with flashloan
npm run start:flashloan:prod    # Production mode with flashloan
npm run dev:flashloan           # Watch mode for flashloan bot
```

## Configuration

### Configuration Files
- `configs/global.example.toml` - Global configuration template (copy to `global.toml`)
- `configs/strategy-small.toml` - Strategy for capital < 10 SOL
- `configs/strategy-medium.toml` - Strategy for 10-100 SOL
- `configs/strategy-large.toml` - Strategy for > 100 SOL
- `.env.example` - Environment variables template (copy to `.env`)

### Important Configuration Notes
- **MUST** set `acknowledge_terms_of_service = true` in global.toml to run
- Use dedicated hot wallets, never main wallets
- Configure proxy settings for users in restricted regions (see `docs/config/代理配置快速指南.md`)

## Architecture

### Package Structure (Monorepo)

This is a pnpm workspace monorepo with the following packages:

1. **`packages/core`** - Core functionality and shared modules
   - `economics/` - Cost calculation, profit analysis, risk management, circuit breaker
   - `flashloan/` - Flashloan adapters (Jupiter Lend, Solend) and transaction builder
   - `solana/` - Solana connection, keypair, transaction utilities, Jupiter swap integration
   - `network/` - Unified proxy adapter and network configuration
   - `database/` - Opportunity tracking and analytics (Prisma ORM)
   - `monitoring/` - Performance metrics and alerting
   - `config/` - TOML configuration loader and proxy config
   - `logger/` - Pino-based logging system
   - `lut/` - Lookup table utilities

2. **`packages/onchain-bot`** - On-chain scanner bot
   - Scans blockchain events directly for arbitrage opportunities
   - `arbitrage-engine.ts` - Core arbitrage detection logic
   - `market-scanner.ts` - Market scanning and pool monitoring
   - `parsers/` - DEX-specific parsers
   - `executors/` - Jito and spam executors

3. **`packages/jupiter-bot`** - Jupiter API-based bot
   - Uses self-hosted Jupiter API for high-frequency opportunity discovery
   - `flashloan-bot.ts` - Main flashloan bot logic
   - `flashloan-entry.ts` - Entry point
   - `opportunity-finder.ts` - High-frequency opportunity scanner
   - `rust-cache-client.ts` - Rust pool cache integration
   - `workers/` - Multi-threaded scanning workers
   - `executors/` - Spam and Jito executors with leader scheduling
   - `compute-unit-optimizer.ts` - Dynamic compute unit optimization
   - `lst-redeemer.ts` - LST (Liquid Staking Token) redemption

4. **`packages/jupiter-server`** - Self-hosted Jupiter API server
   - Local Jupiter API instance for lower latency

5. **`packages/launcher`** - Bot launcher utilities

### Economics System

The economics module is the brain of the system:

- **CostCalculator**: Calculates all costs (base fee, priority fee, Jito tips, flashloan fees)
- **JitoTipOptimizer**: Dynamic tip calculation based on competition, profit share, and historical learning
- **ProfitAnalyzer**: ROI analysis, slippage estimation, batch opportunity evaluation
- **RiskManager**: 5-layer risk checks (profit threshold, cost limits, slippage, liquidity, ROI)
- **CircuitBreaker**: Auto-protection against consecutive failures, hourly losses, low success rates

See `packages/core/src/economics/README.md` for detailed API documentation.

### Execution Strategies

1. **Jito Bundle** - Submit transactions via Jito Block Engine for MEV protection
   - Higher success rate but requires tip payment
   - Used for medium-large capital strategies

2. **RPC Spam** - Rapidly send transactions to multiple RPC endpoints
   - Lower cost but lower success rate
   - Used for small capital strategies

### Flashloan Integration

Supports two flashloan protocols:
- **Jupiter Lend** (preferred) - 0.09% fee
- **Solend** - Alternative option

Flashloan allows executing large arbitrage with minimal capital by borrowing assets within a transaction.

## Key Technical Patterns

### Proxy Configuration
The system has sophisticated proxy support for users in restricted regions:
- Unified adapter in `packages/core/src/network/unified-adapter.ts`
- Automatically configures HTTPS/SOCKS proxies for all network calls
- TLS connection warmup to reduce cold start latency

### Performance Optimization
- **Connection pooling**: Reuses HTTP connections
- **TLS warmup**: Pre-warms TLS connections to critical endpoints
- **Rust cache integration**: Uses Rust-based pool cache for faster lookups
- **Multi-threading**: Worker threads for parallel opportunity scanning
- **Latency tracking**: Comprehensive performance monitoring

See `docs/performance/LATENCY_OPTIMIZATION_COMPLETE.md` for detailed optimization strategies.

### Database Schema
Uses Prisma ORM with PostgreSQL (optional) for tracking:
- Arbitrage opportunities discovered
- Trade execution results
- Route performance
- Validation data

Schema location: `packages/core/prisma/schema.prisma`

## Testing Strategy

- **Unit tests**: `tests/unit/` - Test individual modules
- **Integration tests**: `tests/integration/` - Test module interactions
- **Performance tests**: `tests/performance/` - Benchmark and stress tests
- Jest configuration: `jest.config.js`
- Always use `--no-coverage` for fast iteration during development

## Important Development Notes

### Solana Web3.js Version
- **CRITICAL**: Project pins `@solana/web3.js` to `1.98.4` in pnpm overrides
- Do not upgrade without testing - newer versions may break compatibility

### TypeScript Configuration
- Target: ES2022, CommonJS modules
- Strict mode enabled
- Includes: `packages/**/*`, `tools/**/*`, `examples/**/*`
- Build outputs to `dist/` in each package

### Cost Structure Reference
| Cost Type | Amount | Notes |
|-----------|--------|-------|
| Base transaction fee | 5,000 lamports/signature | Fixed |
| Priority fee | Variable | (CU × price) / 1,000,000 |
| Jito tip (50th) | ~10,000 lamports | Real-time market |
| Jito tip (95th) | ~1,400,000 lamports | High success rate |
| Flashloan fee | 0.09% | Of borrowed amount |

### Strategy Matrix
| Capital | Flashloan | Jito Strategy | Min Profit | Success Rate |
|---------|-----------|---------------|------------|-------------|
| Small (<10 SOL) | Required | 50th percentile | 0.0001 SOL | 50% |
| Medium (10-100 SOL) | Auto | 75th percentile | 0.00005 SOL | 70% |
| Large (>100 SOL) | No | 95th percentile | 0.00003 SOL | 90% |

## Documentation

Comprehensive documentation in `docs/` directory:
- `docs/quickstart/` - Getting started guides
- `docs/config/` - Configuration guides
- `docs/performance/` - Performance optimization (recently updated)
- `docs/deployment/` - Deployment checklists
- `docs/testing/` - Testing guides
- `docs/guidelines/` - Development guidelines
- `docs/bugfixes/` - Bug fix reports
- `docs/implementation/` - Feature implementation reports

See `docs/README.md` for complete documentation index.

## Common Pitfalls

1. **Forgetting to set `acknowledge_terms_of_service = true`** - Bot will not start
2. **Using main wallet** - Always use dedicated hot wallets
3. **Insufficient balance** - Keep minimum balance as configured in strategy
4. **Proxy misconfiguration** - Check proxy settings if in restricted regions
5. **RPC rate limits** - Use paid RPC endpoints for production
6. **Jito leader not scheduled** - Bot waits for Jito validator as leader
7. **Circuit breaker triggered** - Check health metrics when trading stops

## When Editing Code

- Follow existing TypeScript patterns and conventions
- Costs are always in lamports (1 SOL = 10^9 lamports)
- Use the unified proxy adapter for all network calls
- Always update relevant tests when modifying core logic
- Economics module changes may affect strategy configurations
- Database schema changes require Prisma migration
- Log important events using the Pino logger from `packages/core/src/logger`
- Handle errors gracefully - circuit breaker depends on error tracking

## Debugging

```bash
# Check wallet addresses
ts-node get-wallet-addresses.ts

# Monitor Jito tips in real-time
npm run jito-monitor

# Simulate costs for different scenarios
npm run cost-sim -- --help

# Test Jupiter swap integration
npm run test-jupiter

# View latency statistics
# See docs/performance/如何查看延迟统计日志.md
```

## Security Notes

- Never commit `.env` or `global.toml` files
- Keypairs stored in `keypairs/` directory (gitignored)
- Use environment variables for sensitive data
- Test on devnet before mainnet
- Start with small amounts
- Monitor circuit breaker health score
