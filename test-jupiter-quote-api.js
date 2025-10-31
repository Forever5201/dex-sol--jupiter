"use strict";
/**
 * Jupiter Quote API 测试脚本
 *
 * 测试目标：
 * 1. 验证 Legacy Swap API (/swap/v1) 的正确调用方式
 * 2. 测试 /quote 和 /swap-instructions 端点
 * 3. 验证对 Ultra API 给出机会的构建能力
 * 4. 诊断 TLS 连接问题
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var axios_1 = __importDefault(require("axios"));
var web3_js_1 = require("@solana/web3.js");
// 简单的日志记录器
var logger = {
    info: function (msg) { return console.log("[INFO] ".concat(msg)); },
    error: function (msg) { return console.error("[ERROR] ".concat(msg)); },
    debug: function (msg) { return console.log("[DEBUG] ".concat(msg)); },
    warn: function (msg) { return console.warn("[WARN] ".concat(msg)); },
};
// 测试配置
var TEST_CONFIG = {
    // Legacy Swap API (官方文档推荐用于 flash loan)
    legacyApiBaseUrl: 'https://lite-api.jup.ag/swap/v1',
    // Quote API V6 (已废弃)
    quoteApiV6BaseUrl: 'https://quote-api.jup.ag/v6',
    // Ultra API (仅用于获取报价，不用于构建)
    ultraApiBaseUrl: 'https://lite-api.jup.ag/ultra/v1',
    // 测试交易对（模拟 Ultra 给出的机会）
    testSwap: {
        inputMint: 'So11111111111111111111111111111111111111112', // SOL
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        amount: '100000000', // 0.1 SOL
        slippageBps: '50',
    },
    // 测试钱包（只用于构建，不会签名）
    testWallet: 'jdocuPgEAjMfihABsPgKEvYtsmMzjUHeq9LX4Hvs7f3',
};
/**
 * 创建 axios 实例（不使用代理）
 */
function createAxiosClient(baseURL) {
    return axios_1.default.create({
        baseURL: baseURL,
        timeout: 30000,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'JupiterTest/1.0',
        },
        validateStatus: function (status) { return status < 500; },
    });
}
/**
 * 测试 1: Legacy Swap API - /quote
 */
function testLegacyQuote() {
    return __awaiter(this, void 0, void 0, function () {
        var client, params, startTime, response, duration, error_1;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    logger.info('\n=== 测试 1: Legacy Swap API - /quote ===');
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    client = createAxiosClient(TEST_CONFIG.legacyApiBaseUrl);
                    params = {
                        inputMint: TEST_CONFIG.testSwap.inputMint,
                        outputMint: TEST_CONFIG.testSwap.outputMint,
                        amount: TEST_CONFIG.testSwap.amount,
                        slippageBps: TEST_CONFIG.testSwap.slippageBps,
                        onlyDirectRoutes: 'false',
                    };
                    logger.info("\u8BF7\u6C42: GET ".concat(TEST_CONFIG.legacyApiBaseUrl, "/quote"));
                    logger.info("\u53C2\u6570: ".concat(JSON.stringify(params, null, 2)));
                    startTime = Date.now();
                    return [4 /*yield*/, client.get('/quote', { params: params })];
                case 2:
                    response = _b.sent();
                    duration = Date.now() - startTime;
                    if (response.status === 200 && response.data) {
                        logger.info("\u2705 \u6210\u529F! \u8017\u65F6: ".concat(duration, "ms"));
                        logger.info("\u51FA\u91D1: ".concat(response.data.outAmount));
                        logger.info("\u8DEF\u7531: ".concat(((_a = response.data.routePlan) === null || _a === void 0 ? void 0 : _a.length) || 0, " \u8DF3"));
                        if (response.data.routePlan) {
                            response.data.routePlan.forEach(function (hop, i) {
                                var _a;
                                logger.info("  \u8DF3 ".concat(i + 1, ": ").concat(((_a = hop.swapInfo) === null || _a === void 0 ? void 0 : _a.label) || 'Unknown DEX'));
                            });
                        }
                        return [2 /*return*/, { success: true, quote: response.data }];
                    }
                    else {
                        logger.error("\u274C \u5931\u8D25: HTTP ".concat(response.status));
                        logger.error(JSON.stringify(response.data, null, 2));
                        return [2 /*return*/, { success: false, error: response.data }];
                    }
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _b.sent();
                    logger.error("\u274C \u5F02\u5E38: ".concat(error_1.message));
                    if (error_1.code)
                        logger.error("\u9519\u8BEF\u4EE3\u7801: ".concat(error_1.code));
                    if (error_1.response) {
                        logger.error("\u54CD\u5E94\u72B6\u6001: ".concat(error_1.response.status));
                        logger.error("\u54CD\u5E94\u6570\u636E: ".concat(JSON.stringify(error_1.response.data, null, 2)));
                    }
                    return [2 /*return*/, { success: false, error: error_1.message }];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * 测试 2: Legacy Swap API - /swap-instructions
 */
function testLegacySwapInstructions(quoteResponse) {
    return __awaiter(this, void 0, void 0, function () {
        var client, body, startTime, response, duration, _a, computeBudgetInstructions, setupInstructions, swapInstruction, cleanupInstruction, addressLookupTableAddresses, error_2;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    logger.info('\n=== 测试 2: Legacy Swap API - /swap-instructions ===');
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    client = createAxiosClient(TEST_CONFIG.legacyApiBaseUrl);
                    body = {
                        quoteResponse: quoteResponse,
                        userPublicKey: TEST_CONFIG.testWallet,
                        wrapAndUnwrapSol: true,
                        dynamicComputeUnitLimit: true,
                    };
                    logger.info("\u8BF7\u6C42: POST ".concat(TEST_CONFIG.legacyApiBaseUrl, "/swap-instructions"));
                    logger.info("Body \u5B57\u6BB5: ".concat(Object.keys(body).join(', ')));
                    startTime = Date.now();
                    return [4 /*yield*/, client.post('/swap-instructions', body)];
                case 2:
                    response = _c.sent();
                    duration = Date.now() - startTime;
                    if (response.status === 200 && response.data) {
                        logger.info("\u2705 \u6210\u529F! \u8017\u65F6: ".concat(duration, "ms"));
                        _a = response.data, computeBudgetInstructions = _a.computeBudgetInstructions, setupInstructions = _a.setupInstructions, swapInstruction = _a.swapInstruction, cleanupInstruction = _a.cleanupInstruction, addressLookupTableAddresses = _a.addressLookupTableAddresses;
                        logger.info("\u6307\u4EE4\u7EDF\u8BA1:");
                        logger.info("  - Compute Budget: ".concat((computeBudgetInstructions === null || computeBudgetInstructions === void 0 ? void 0 : computeBudgetInstructions.length) || 0));
                        logger.info("  - Setup: ".concat((setupInstructions === null || setupInstructions === void 0 ? void 0 : setupInstructions.length) || 0));
                        logger.info("  - Swap: ".concat(swapInstruction ? 1 : 0));
                        logger.info("  - Cleanup: ".concat(cleanupInstruction ? 1 : 0));
                        logger.info("  - Lookup Tables: ".concat((addressLookupTableAddresses === null || addressLookupTableAddresses === void 0 ? void 0 : addressLookupTableAddresses.length) || 0));
                        // 验证指令结构
                        if (swapInstruction) {
                            logger.info("Swap \u6307\u4EE4\u7ED3\u6784:");
                            logger.info("  - programId: ".concat(swapInstruction.programId));
                            logger.info("  - accounts: ".concat(((_b = swapInstruction.accounts) === null || _b === void 0 ? void 0 : _b.length) || 0));
                            logger.info("  - data: ".concat(swapInstruction.data ? '✅' : '❌'));
                        }
                        return [2 /*return*/, { success: true, instructions: response.data }];
                    }
                    else {
                        logger.error("\u274C \u5931\u8D25: HTTP ".concat(response.status));
                        logger.error(JSON.stringify(response.data, null, 2));
                        return [2 /*return*/, { success: false, error: response.data }];
                    }
                    return [3 /*break*/, 4];
                case 3:
                    error_2 = _c.sent();
                    logger.error("\u274C \u5F02\u5E38: ".concat(error_2.message));
                    if (error_2.code)
                        logger.error("\u9519\u8BEF\u4EE3\u7801: ".concat(error_2.code));
                    if (error_2.response) {
                        logger.error("\u54CD\u5E94\u72B6\u6001: ".concat(error_2.response.status));
                        logger.error("\u54CD\u5E94\u6570\u636E: ".concat(JSON.stringify(error_2.response.data, null, 2)));
                    }
                    return [2 /*return*/, { success: false, error: error_2.message }];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * 测试 3: Quote API V6 - /quote (对比测试)
 */
function testQuoteAPIV6() {
    return __awaiter(this, void 0, void 0, function () {
        var client, params, startTime, response, duration, error_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    logger.info('\n=== 测试 3: Quote API V6 - /quote (对比) ===');
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    client = createAxiosClient(TEST_CONFIG.quoteApiV6BaseUrl);
                    params = {
                        inputMint: TEST_CONFIG.testSwap.inputMint,
                        outputMint: TEST_CONFIG.testSwap.outputMint,
                        amount: TEST_CONFIG.testSwap.amount,
                        slippageBps: TEST_CONFIG.testSwap.slippageBps,
                    };
                    logger.info("\u8BF7\u6C42: GET ".concat(TEST_CONFIG.quoteApiV6BaseUrl, "/quote"));
                    startTime = Date.now();
                    return [4 /*yield*/, client.get('/quote', { params: params })];
                case 2:
                    response = _a.sent();
                    duration = Date.now() - startTime;
                    if (response.status === 200 && response.data) {
                        logger.info("\u2705 \u6210\u529F! \u8017\u65F6: ".concat(duration, "ms"));
                        logger.info("\u51FA\u91D1: ".concat(response.data.outAmount));
                        return [2 /*return*/, { success: true, quote: response.data }];
                    }
                    else {
                        logger.error("\u274C \u5931\u8D25: HTTP ".concat(response.status));
                        return [2 /*return*/, { success: false, error: response.data }];
                    }
                    return [3 /*break*/, 4];
                case 3:
                    error_3 = _a.sent();
                    logger.error("\u274C \u5F02\u5E38: ".concat(error_3.message));
                    if (error_3.code)
                        logger.error("\u9519\u8BEF\u4EE3\u7801: ".concat(error_3.code));
                    return [2 /*return*/, { success: false, error: error_3.message }];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * 测试 4: Ultra API - /order (获取报价作为对比)
 */
function testUltraOrder() {
    return __awaiter(this, void 0, void 0, function () {
        var client, params, startTime, response, duration, error_4;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    logger.info('\n=== 测试 4: Ultra API - /order (报价对比) ===');
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    client = createAxiosClient(TEST_CONFIG.ultraApiBaseUrl);
                    params = {
                        inputMint: TEST_CONFIG.testSwap.inputMint,
                        outputMint: TEST_CONFIG.testSwap.outputMint,
                        amount: TEST_CONFIG.testSwap.amount,
                        taker: TEST_CONFIG.testWallet,
                    };
                    logger.info("\u8BF7\u6C42: GET ".concat(TEST_CONFIG.ultraApiBaseUrl, "/order"));
                    startTime = Date.now();
                    return [4 /*yield*/, client.get('/order', { params: params })];
                case 2:
                    response = _b.sent();
                    duration = Date.now() - startTime;
                    if (response.status === 200 && response.data) {
                        logger.info("\u2705 \u6210\u529F! \u8017\u65F6: ".concat(duration, "ms"));
                        logger.info("\u51FA\u91D1: ".concat(response.data.outAmount));
                        logger.info("\u8DEF\u7531: ".concat(((_a = response.data.routePlan) === null || _a === void 0 ? void 0 : _a.length) || 0, " \u8DF3"));
                        if (response.data.routePlan) {
                            response.data.routePlan.forEach(function (hop, i) {
                                var _a;
                                logger.info("  \u8DF3 ".concat(i + 1, ": ").concat(((_a = hop.swapInfo) === null || _a === void 0 ? void 0 : _a.label) || 'Unknown DEX'));
                            });
                        }
                        return [2 /*return*/, { success: true, order: response.data }];
                    }
                    else {
                        logger.error("\u274C \u5931\u8D25: HTTP ".concat(response.status));
                        return [2 /*return*/, { success: false, error: response.data }];
                    }
                    return [3 /*break*/, 4];
                case 3:
                    error_4 = _b.sent();
                    logger.error("\u274C \u5F02\u5E38: ".concat(error_4.message));
                    if (error_4.code)
                        logger.error("\u9519\u8BEF\u4EE3\u7801: ".concat(error_4.code));
                    return [2 /*return*/, { success: false, error: error_4.message }];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * 测试 5: 指令反序列化
 */
function testInstructionDeserialization(instructionsData) {
    logger.info('\n=== 测试 5: 指令反序列化 ===');
    try {
        var deserializeInstruction = function (instruction) {
            return new web3_js_1.TransactionInstruction({
                programId: new web3_js_1.PublicKey(instruction.programId),
                keys: instruction.accounts.map(function (key) { return ({
                    pubkey: new web3_js_1.PublicKey(key.pubkey),
                    isSigner: key.isSigner,
                    isWritable: key.isWritable,
                }); }),
                data: Buffer.from(instruction.data, 'base64'),
            });
        };
        var swapInstruction = instructionsData.swapInstruction;
        if (!swapInstruction) {
            logger.error('❌ 没有 swap 指令');
            return { success: false };
        }
        var deserializedIx = deserializeInstruction(swapInstruction);
        logger.info('✅ 指令反序列化成功');
        logger.info("  - Program ID: ".concat(deserializedIx.programId.toBase58()));
        logger.info("  - Keys: ".concat(deserializedIx.keys.length));
        logger.info("  - Data Length: ".concat(deserializedIx.data.length, " bytes"));
        return { success: true, instruction: deserializedIx };
    }
    catch (error) {
        logger.error("\u274C \u53CD\u5E8F\u5217\u5316\u5931\u8D25: ".concat(error.message));
        return { success: false, error: error.message };
    }
}
/**
 * 测试 6: 使用 Ultra 路由引导 Legacy API
 */
function testUltraGuidedLegacyQuote(ultraRoutePlan) {
    return __awaiter(this, void 0, void 0, function () {
        var dexes, client, params, startTime, response, duration, legacyDexes_1, matched, error_5;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    logger.info('\n=== 测试 6: 使用 Ultra 路由引导 Legacy API ===');
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    dexes = ultraRoutePlan
                        .map(function (hop) { var _a; return (_a = hop.swapInfo) === null || _a === void 0 ? void 0 : _a.label; })
                        .filter(Boolean);
                    logger.info("Ultra \u8DEF\u7531\u4F7F\u7528\u7684 DEX: ".concat(dexes.join(', ')));
                    client = createAxiosClient(TEST_CONFIG.legacyApiBaseUrl);
                    params = {
                        inputMint: TEST_CONFIG.testSwap.inputMint,
                        outputMint: TEST_CONFIG.testSwap.outputMint,
                        amount: TEST_CONFIG.testSwap.amount,
                        slippageBps: TEST_CONFIG.testSwap.slippageBps,
                        dexes: dexes.join(','), // 🔥 引导路由
                    };
                    logger.info("\u8BF7\u6C42: GET ".concat(TEST_CONFIG.legacyApiBaseUrl, "/quote"));
                    logger.info("\u4F7F\u7528 dexes \u53C2\u6570: ".concat(params.dexes));
                    startTime = Date.now();
                    return [4 /*yield*/, client.get('/quote', { params: params })];
                case 2:
                    response = _a.sent();
                    duration = Date.now() - startTime;
                    if (response.status === 200 && response.data) {
                        logger.info("\u2705 \u6210\u529F! \u8017\u65F6: ".concat(duration, "ms"));
                        logger.info("\u51FA\u91D1: ".concat(response.data.outAmount));
                        // 比较路由
                        if (response.data.routePlan) {
                            legacyDexes_1 = response.data.routePlan.map(function (hop) { var _a; return (_a = hop.swapInfo) === null || _a === void 0 ? void 0 : _a.label; });
                            logger.info("Legacy API \u5B9E\u9645\u4F7F\u7528\u7684 DEX: ".concat(legacyDexes_1.join(', ')));
                            matched = dexes.every(function (dex, i) { return dex === legacyDexes_1[i]; });
                            logger.info("\u8DEF\u7531\u5339\u914D: ".concat(matched ? '✅ 完全匹配' : '⚠️ 不完全匹配'));
                        }
                        return [2 /*return*/, { success: true, quote: response.data }];
                    }
                    else {
                        logger.error("\u274C \u5931\u8D25: HTTP ".concat(response.status));
                        return [2 /*return*/, { success: false, error: response.data }];
                    }
                    return [3 /*break*/, 4];
                case 3:
                    error_5 = _a.sent();
                    logger.error("\u274C \u5F02\u5E38: ".concat(error_5.message));
                    return [2 /*return*/, { success: false, error: error_5.message }];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * 主测试流程
 */
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var results, _a, _b, _c, _d, _e, legacyOut, ultraOut, diff;
        var _f, _g, _h, _j, _k, _l, _m;
        return __generator(this, function (_o) {
            switch (_o.label) {
                case 0:
                    logger.info('🚀 Jupiter Quote API 完整测试开始\n');
                    logger.info('测试目标: 验证 Legacy Swap API 对 Ultra 机会的构建能力\n');
                    results = {
                        legacyQuote: null,
                        legacyInstructions: null,
                        quoteV6: null,
                        ultraOrder: null,
                        deserialization: null,
                        guidedQuote: null,
                    };
                    // 测试 1: Legacy Quote
                    _a = results;
                    return [4 /*yield*/, testLegacyQuote()];
                case 1:
                    // 测试 1: Legacy Quote
                    _a.legacyQuote = _o.sent();
                    if (!results.legacyQuote.success) return [3 /*break*/, 3];
                    _b = results;
                    return [4 /*yield*/, testLegacySwapInstructions(results.legacyQuote.quote)];
                case 2:
                    _b.legacyInstructions = _o.sent();
                    // 测试 5: 反序列化
                    if (results.legacyInstructions.success) {
                        results.deserialization = testInstructionDeserialization(results.legacyInstructions.instructions);
                    }
                    _o.label = 3;
                case 3:
                    // 测试 3: Quote API V6 (对比)
                    _c = results;
                    return [4 /*yield*/, testQuoteAPIV6()];
                case 4:
                    // 测试 3: Quote API V6 (对比)
                    _c.quoteV6 = _o.sent();
                    // 测试 4: Ultra Order (对比)
                    _d = results;
                    return [4 /*yield*/, testUltraOrder()];
                case 5:
                    // 测试 4: Ultra Order (对比)
                    _d.ultraOrder = _o.sent();
                    if (!(results.ultraOrder.success && results.ultraOrder.order.routePlan)) return [3 /*break*/, 7];
                    _e = results;
                    return [4 /*yield*/, testUltraGuidedLegacyQuote(results.ultraOrder.order.routePlan)];
                case 6:
                    _e.guidedQuote = _o.sent();
                    _o.label = 7;
                case 7:
                    // 总结
                    logger.info('\n' + '='.repeat(60));
                    logger.info('📊 测试总结');
                    logger.info('='.repeat(60));
                    logger.info("\n1\uFE0F\u20E3  Legacy Quote: ".concat(results.legacyQuote.success ? '✅' : '❌'));
                    logger.info("2\uFE0F\u20E3  Legacy Swap Instructions: ".concat(((_f = results.legacyInstructions) === null || _f === void 0 ? void 0 : _f.success) ? '✅' : '❌'));
                    logger.info("3\uFE0F\u20E3  Quote API V6: ".concat(results.quoteV6.success ? '✅' : '❌'));
                    logger.info("4\uFE0F\u20E3  Ultra Order: ".concat(results.ultraOrder.success ? '✅' : '❌'));
                    logger.info("5\uFE0F\u20E3  Instruction Deserialization: ".concat(((_g = results.deserialization) === null || _g === void 0 ? void 0 : _g.success) ? '✅' : '❌'));
                    logger.info("6\uFE0F\u20E3  Ultra-Guided Legacy Quote: ".concat(((_h = results.guidedQuote) === null || _h === void 0 ? void 0 : _h.success) ? '✅' : '❌'));
                    // 价格对比
                    if (results.legacyQuote.success && results.ultraOrder.success) {
                        legacyOut = BigInt(results.legacyQuote.quote.outAmount);
                        ultraOut = BigInt(results.ultraOrder.order.outAmount);
                        diff = Number((ultraOut - legacyOut) * BigInt(10000) / legacyOut) / 100;
                        logger.info("\n\uD83D\uDCB0 \u4EF7\u683C\u5BF9\u6BD4:");
                        logger.info("  Legacy API: ".concat(results.legacyQuote.quote.outAmount));
                        logger.info("  Ultra API:  ".concat(results.ultraOrder.order.outAmount));
                        logger.info("  \u5DEE\u5F02: ".concat(diff > 0 ? '+' : '').concat(diff.toFixed(2), "%"));
                    }
                    // 建议
                    logger.info("\n\uD83D\uDCA1 \u5EFA\u8BAE:");
                    if ((_j = results.legacyInstructions) === null || _j === void 0 ? void 0 : _j.success) {
                        logger.info('✅ Legacy Swap API 可以正常工作，建议使用：');
                        logger.info('   - 使用 https://lite-api.jup.ag/swap/v1/quote');
                        logger.info('   - 使用 https://lite-api.jup.ag/swap/v1/swap-instructions');
                    }
                    else {
                        logger.info('❌ Legacy Swap API 存在问题，需要调查：');
                        if ((_l = (_k = results.legacyQuote.error) === null || _k === void 0 ? void 0 : _k.includes) === null || _l === void 0 ? void 0 : _l.call(_k, 'socket')) {
                            logger.info('   - 可能是网络/代理问题');
                            logger.info('   - 尝试直连或更换代理');
                        }
                    }
                    if ((_m = results.guidedQuote) === null || _m === void 0 ? void 0 : _m.success) {
                        logger.info('✅ Ultra 路由引导功能正常，可以复制 Ultra 的最优路由');
                    }
                    logger.info('\n✅ 测试完成!\n');
                    return [2 /*return*/, results];
            }
        });
    });
}
// 运行测试
main().catch(function (error) {
    logger.error("Fatal error: ".concat(error.message));
    console.error(error);
    process.exit(1);
});
