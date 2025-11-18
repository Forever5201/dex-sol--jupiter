# Solana Arbitrage Bot - AI Agent Development Guide

## Project Overview

This is a production-grade Solana DEX arbitrage trading system implementing a comprehensive economic model for professional arbitrage operations. The project is built with TypeScript and uses a monorepo structure with pnpm workspaces.

**Key Features:**
- Complete cost calculation including base fees, priority fees, Jito tips, and flash loan costs
- Dynamic Jito tip optimization with real-time market data and historical learning
- Profit analysis engine with gross/net profit and ROI calculations
- 5-layer risk management system with opportunity validation
- Circuit breaker protection with consecutive failure detection
- Configuration-driven strategies for different capital sizes
- Comprehensive toolset including cost simulator and Jito monitor

## Technology Stack

- **Runtime:** Node.js >= 20.0.0
- **Language:** TypeScript 5.3+
- **Package Manager:** pnpm (with workspaces)
- **Testing:** Jest with ts-jest
- **Build Tool:** TypeScript compiler (tsc)
- **Key Dependencies:**
  - @solana/web3.js 1.98.4 (pinned version)
  - @jup-ag/lend (Jupiter lending integration)
  - @solana/spl-token (SPL token operations)
  - Express.js (for API servers)

## Project Structure

```
solana-arb-bot/
├── packages/                    # Monorepo packages
│   ├── core/                   # Core economic model and utilities
│   │   ├── src/economics/      # Economic model components
│   │   ├── src/solana/         # Solana blockchain utilities
│   │   ├── src/config/         # Configuration management
│   │   ├── src/database/       # Database integration
│   │   └── src/network/        # Network and proxy management
│   ├── jupiter-bot/            # Jupiter-based arbitrage bot
│   │   ├── src/executors/      # Trade execution strategies
│   │   ├── src/dex/            # DEX integrations
│   │   └── src/workers/        # Background workers
│   ├── onchain-bot/            # Direct on-chain arbitrage bot
│   ├── jupiter-server/         # Self-hosted Jupiter API server
│   └── launcher/               # Bot launcher and orchestration
├── configs/                    # Configuration files
│   ├── global.toml            # Global configuration
│   ├── strategy-*.toml        # Strategy configurations (small/medium/large)
│   └── flashloan-*.toml       # Flashloan-specific configs
├── tools/                      # Development and analysis tools
│   ├── cost-simulator/        # Transaction cost simulation
│   └── jito-monitor/          # Jito tip market monitoring
├── examples/                   # Usage examples and demos
├── tests/                      # Test suites
│   ├── unit/                  # Unit tests
│   ├── integration/           # Integration tests
│   └── performance/           # Performance and stress tests
└── docs/                       # Documentation
```

## Build and Development Commands

### Installation and Setup
```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Clean build artifacts
npm run clean
```

### Development Commands
```bash
# Run core development mode
npm run dev

# Run flashloan bot in development
npm run dev:flashloan

# Run cost simulator
npm run cost-sim -- --help

# Run Jito monitor
npm run jito-monitor

# Run economics demo
npm run demo
```

### Testing Commands
```bash
# Run all tests
npm run test:all

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration

# Run performance tests
npm run test:performance

# Run stress tests
npm run test:stress

# Run with coverage
npm run test:coverage
```

### Production Commands
```bash
# Start on-chain bot
npm run start:onchain-bot:prod

# Start flashloan bot
npm run start:flashloan:prod
```

## Code Architecture

### Core Economics Module (`packages/core/src/economics/`)
The heart of the system implementing the arbitrage economic model:

- **CostCalculator**: Calculates total transaction costs including fees, tips, and flash loan costs
- **JitoTipOptimizer**: Dynamic Jito tip optimization based on market conditions
- **ProfitAnalyzer**: Analyzes profitability with gross/net profit and ROI calculations
- **RiskManager**: 5-layer risk assessment system
- **CircuitBreaker**: Protection mechanism against consecutive failures

### Bot Implementations
- **Jupiter Bot**: Uses Jupiter aggregator for route discovery and execution
- **On-Chain Bot**: Direct on-chain scanning and arbitrage detection
- **Flashloan Bot**: Specialized bot for flashloan-based arbitrage strategies

### Configuration System
- TOML-based configuration files for different strategies
- Environment variable support for sensitive data
- Strategy presets for small/medium/large capital sizes
- Proxy configuration for network management

## Development Guidelines

### Code Style
- TypeScript with strict mode enabled
- CommonJS module system
- Consistent error handling with custom error types
- Comprehensive JSDoc comments for public APIs
- Chinese comments for business logic (maintain consistency with existing code)

### Testing Strategy
- Unit tests for individual components
- Integration tests for bot workflows
- Performance tests for latency-critical operations
- Stress tests for system stability
- Test coverage focused on economics module

### Security Considerations
- **CRITICAL**: Always use dedicated hot wallets, never main wallets
- Private keys stored in separate files, never in code
- Configuration files excluded from version control
- Risk acknowledgment required in configuration
- Daily trade and loss limits implemented

### Performance Requirements
- Cost calculation: < 1ms
- Profit analysis: < 5ms  
- Risk checking: < 3ms
- Jito API latency: 50-100ms
- Support for batch processing hundreds of opportunities

## Configuration Management

### Environment Variables
Key environment variables (see `.env.example`):
- `SOLANA_RPC_URL`: Primary RPC endpoint
- `SOLANA_RPC_URLS`: Comma-separated backup RPCs
- `DEFAULT_KEYPAIR_PATH`: Wallet keypair file path
- `JUPITER_API_URL`: Jupiter API endpoint
- `JITO_BLOCK_ENGINE_URL`: Jito block engine URL
- `LOG_LEVEL`: Logging level (debug/info/warn/error)

### Strategy Configuration
Three preset strategies based on capital size:
- **Small Capital** (< 10 SOL): Conservative, cost-focused approach
- **Medium Capital** (10-100 SOL): Balanced strategy with auto flashloan
- **Large Capital** (> 100 SOL): Aggressive, success-focused approach

## Key Implementation Details

### Economic Model
The system implements a sophisticated cost structure:
- Base transaction fee: 5,000 lamports per signature
- Priority fee: Dynamic based on compute units and market conditions
- Jito tip: Real-time market-based optimization
- Flash loan fee: 0.09% of borrowed amount

### Risk Management
5-layer risk checking system:
1. Profit threshold validation
2. Cost limit verification
3. Slippage protection
4. Liquidity validation
5. ROI minimum requirement

### Circuit Breaker
Triggers on any of these conditions:
- Consecutive failures >= threshold
- Hourly loss >= threshold  
- Success rate < minimum requirement
- Negative net profit detected

## Common Development Tasks

### Adding New DEX Integration
1. Implement DEX interface in `packages/jupiter-bot/src/dex/`
2. Add pool parsing logic
3. Update opportunity finder configuration
4. Add integration tests

### Modifying Economic Parameters
1. Update relevant files in `packages/core/src/economics/`
2. Adjust configuration schemas if needed
3. Update cost simulator tool
4. Run comprehensive tests

### Adding New Configuration Options
1. Update TOML schema in config files
2. Modify configuration loader in `packages/core/src/config/`
3. Update TypeScript interfaces
4. Add validation logic

## Debugging and Monitoring

### Logging System
- Structured logging with different levels
- Separate log files for different components
- Real-time metrics output
- Discord/Telegram webhook integration for alerts

### Performance Monitoring
- Latency tracking for all operations
- Success rate monitoring
- Cost analysis reporting
- Opportunity discovery statistics

### Common Issues and Solutions
- **RPC Connection Issues**: Check proxy configuration and RPC health
- **Jito Tip Optimization**: Monitor Jito market conditions
- **High Slippage**: Adjust liquidity requirements and route complexity
- **Low Success Rate**: Review circuit breaker configuration and market conditions

## Deployment Considerations

### Production Readiness
- Use dedicated server infrastructure
- Implement proper monitoring and alerting
- Regular backup of configuration and keys
- Network redundancy with multiple RPC endpoints
- Consider geographic distribution for latency optimization

### Security Checklist
- [ ] Dedicated hot wallet configured
- [ ] Private keys properly secured
- [ ] Configuration files protected
- [ ] Risk acknowledgment set to true
- [ ] Daily limits configured appropriately
- [ ] Monitoring and alerting enabled

This guide should be updated as the project evolves. Always refer to the latest documentation and configuration files for the most current information.