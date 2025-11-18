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
   - Waits for Jito leader scheduling for optimal timing

2. **RPC Spam** - Rapidly send transactions to multiple RPC endpoints
   - Lower cost but lower success rate
   - Used for small capital strategies
   - Sends to multiple RPCs simultaneously for higher inclusion probability

### Strategy Selection Logic
The system automatically selects execution strategy based on:
- **Capital size**: Determines minimum profit thresholds and risk tolerance
- **Profit potential**: Higher profits can justify higher Jito tips
- **Market conditions**: Dynamic tip optimization based on competition
- **Success rate targets**: Each strategy tier has specific success rate goals

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
Uses Prisma ORM with PostgreSQL (optional) for comprehensive tracking:
- **Opportunity lifecycle**: Discovery → Simulation → Validation → Execution
- **Performance metrics**: Detailed latency stats and parallel processing statistics
- **Filter tracking**: Records why and when opportunities are filtered out
- **Daily analytics**: Automatic profit/loss aggregation and success rate tracking

Schema location: `packages/core/prisma/schema.prisma`

Key tables: Trade, Opportunity, TradeRoute, DailyStatistic, OpportunityValidation

## Testing Strategy

- **Unit tests**: `tests/unit/` - Test individual modules
- **Integration tests**: `tests/integration/` - Test module interactions
- **Performance tests**: `tests/performance/` - Benchmark and stress tests
- Jest configuration: `jest.config.js`
- Always use `--no-coverage` for fast iteration during development

## Important Development Notes

### System Requirements
- **Node.js**: >= 20.0.0 (required for modern Solana operations)
- **pnpm**: Required for workspace management
- **Rust**: Optional but recommended for pool cache performance

### Critical Version Constraints
- **CRITICAL**: `@solana/web3.js` is pinned to `1.98.4` in pnpm overrides - do not upgrade without extensive testing
- **TypeScript**: Target ES2022, CommonJS modules, strict mode enabled
- **Jest**: 30s timeout default, 60s for performance tests, maxWorkers: 50%

### TypeScript Configuration
- Target: ES2022, CommonJS modules
- Strict mode enabled
- Includes: `packages/**/*`, `tools/**/*`, `examples/**/*`
- Build outputs to `dist/` in each package
- Module mapping: `@solana-arb-bot/*` path aliases configured

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

## Common Pitfalls & Critical Issues

### Startup Blockers
1. **Forgetting `acknowledge_terms_of_service = true`** - Bot will not start (most common issue)
2. **Missing keypairs** - Ensure `keypairs/` directory exists with valid keypair files
3. **Insufficient SOL balance** - Keep minimum balance as configured in strategy + transaction fees
4. **Invalid RPC endpoints** - Use paid RPC endpoints for production (free tiers have rate limits)

### Runtime Issues
5. **Jito leader not scheduled** - Bot waits for Jito validator as leader (check `npm run jito-monitor`)
6. **Circuit breaker triggered** - Check health metrics when trading stops (see monitoring logs)
7. **Proxy misconfiguration** - Check proxy settings if in restricted regions
8. **Database connection failures** - PostgreSQL is optional but migrations must be run if enabled

### Performance Issues
9. **Rust cache not running** - Ensure `rust-pool-cache` is built and running for optimal performance
10. **Worker thread exhaustion** - Monitor worker pool usage in high-frequency scenarios
11. **Memory leaks** - Watch for unclosed WebSocket connections or event listeners

### Version-Specific Issues
12. **Solana web3.js upgrades** - Never upgrade beyond 1.98.4 without extensive testing
13. **Node.js compatibility** - Use Node.js >= 20.0.0 for optimal performance

## When Editing Code

### Code Standards
- Follow existing TypeScript patterns and conventions
- Costs are always in lamports (1 SOL = 10^9 lamports)
- Use the unified proxy adapter for all network calls
- Always update relevant tests when modifying core logic
- Economics module changes may affect strategy configurations
- Database schema changes require Prisma migration
- Log important events using the Pino logger from `packages/core/src/logger`
- Handle errors gracefully - circuit breaker depends on error tracking

### Critical Files to Understand
1. **`packages/core/src/economics/`** - The "brain" of the system, all profit calculations flow through here
2. **`packages/core/src/network/unified-adapter.ts`** - All network calls must go through this adapter
3. **`packages/jupiter-bot/src/opportunity-finder.ts`** - Core opportunity discovery logic
4. **`rust-pool-cache/src/router_advanced.rs`** - High-performance routing algorithms

### Architecture Patterns to Follow
- **Factory Pattern**: Use `createEconomicsSystem()` for instantiating economic components
- **Parallel Validation**: Opportunities go through discovery → simulation → validation → execution
- **Error Propagation**: Always preserve error context for circuit breaker tracking
- **Performance Metrics**: Add latency tracking to any new network operations

### Testing Requirements
- Unit tests for economic calculations (critical for financial correctness)
- Integration tests for opportunity flow (discovery → execution)
- Performance tests for any new algorithms or data structures
- Always test with both Jito and RPC spam strategies

## Debugging & Development Tools

### Essential Debugging Commands
```bash
# Check wallet addresses and balances
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

### Advanced Analysis Tools
The system includes 30+ specialized tools for analysis:
- **Pool quality validation**: Check pool data integrity across DEXs
- **Performance profiling**: Detailed latency analysis and optimization verification
- **Opportunity funnel analysis**: Track why opportunities are filtered at each stage
- **HTML dashboards**: Real-time monitoring and historical analysis

Tools are located in `tools/` directory with detailed documentation.

### Environment Configuration
The `.env` file supports extensive configuration:
- **RPC connection pooling**: Configure pool sizes and concurrency limits
- **Proxy settings**: Full HTTP/HTTPS/WebSocket proxy support
- **Performance tuning**: Worker threads, cache TTLs, metric intervals
- **Security limits**: Maximum trade amounts, minimum balance requirements

See `.env.example` for complete configuration options.

## Security Notes

- Never commit `.env` or `global.toml` files
- Keypairs stored in `keypairs/` directory (gitignored)
- Use environment variables for sensitive data
- Test on devnet before mainnet
- Start with small amounts
- Monitor circuit breaker health score
