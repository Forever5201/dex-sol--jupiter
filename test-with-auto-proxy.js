"use strict";
/**
 * 使用自动代理检测的 Jupiter API 测试
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
Object.defineProperty(exports, "__esModule", { value: true });
var core_1 = require("@solana-arb-bot/core");
console.log('========================================');
console.log('  Jupiter API 测试（自动代理）');
console.log('========================================\n');
// 1. 自动设置代理
console.log('[1] 自动检测系统代理...');
(0, core_1.autoSetupProxyEnv)();
console.log("   HTTP_PROXY  = ".concat(process.env.HTTP_PROXY));
console.log("   HTTPS_PROXY = ".concat(process.env.HTTPS_PROXY, "\n"));
// 2. 测试 Legacy Swap API
function testLegacySwapAPI() {
    return __awaiter(this, void 0, void 0, function () {
        var startTime, response, duration, error_1;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    console.log('[2] 测试 Legacy Swap API...');
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    startTime = Date.now();
                    return [4 /*yield*/, core_1.NetworkAdapter.axios.get('https://lite-api.jup.ag/swap/v1/quote', {
                            params: {
                                inputMint: 'So11111111111111111111111111111111111111112',
                                outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                                amount: '100000000',
                                slippageBps: '50',
                            },
                            timeout: 30000,
                        })];
                case 2:
                    response = _b.sent();
                    duration = Date.now() - startTime;
                    if (response.status === 200 && response.data.outAmount) {
                        console.log("   \u2705 \u6210\u529F! \u8017\u65F6: ".concat(duration, "ms"));
                        console.log("   \u51FA\u91D1: ".concat(response.data.outAmount));
                        console.log("   \u8DEF\u7531: ".concat(((_a = response.data.routePlan) === null || _a === void 0 ? void 0 : _a.length) || 0, " \u8DF3\n"));
                        if (response.data.routePlan) {
                            response.data.routePlan.forEach(function (hop, i) {
                                var _a;
                                console.log("      \u8DF3 ".concat(i + 1, ": ").concat(((_a = hop.swapInfo) === null || _a === void 0 ? void 0 : _a.label) || 'Unknown'));
                            });
                        }
                        return [2 /*return*/, true];
                    }
                    else {
                        console.log("   \u274C \u5931\u8D25: HTTP ".concat(response.status, "\n"));
                        return [2 /*return*/, false];
                    }
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _b.sent();
                    console.log("   \u274C \u5F02\u5E38: ".concat(error_1.message));
                    if (error_1.code) {
                        console.log("   \u9519\u8BEF\u4EE3\u7801: ".concat(error_1.code, "\n"));
                    }
                    return [2 /*return*/, false];
                case 4: return [2 /*return*/];
            }
        });
    });
}
// 3. 测试 Ultra API
function testUltraAPI() {
    return __awaiter(this, void 0, void 0, function () {
        var startTime, response, duration, error_2;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    console.log('[3] 测试 Ultra API...');
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    startTime = Date.now();
                    return [4 /*yield*/, core_1.NetworkAdapter.axios.get('https://lite-api.jup.ag/ultra/v1/order', {
                            params: {
                                inputMint: 'So11111111111111111111111111111111111111112',
                                outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                                amount: '100000000',
                                taker: 'jdocuPgEAjMfihABsPgKEvYtsmMzjUHeq9LX4Hvs7f3',
                            },
                            timeout: 30000,
                        })];
                case 2:
                    response = _b.sent();
                    duration = Date.now() - startTime;
                    if (response.status === 200 && response.data.outAmount) {
                        console.log("   \u2705 \u6210\u529F! \u8017\u65F6: ".concat(duration, "ms"));
                        console.log("   \u51FA\u91D1: ".concat(response.data.outAmount));
                        console.log("   \u8DEF\u7531: ".concat(((_a = response.data.routePlan) === null || _a === void 0 ? void 0 : _a.length) || 0, " \u8DF3\n"));
                        return [2 /*return*/, true];
                    }
                    else {
                        console.log("   \u274C \u5931\u8D25: HTTP ".concat(response.status, "\n"));
                        return [2 /*return*/, false];
                    }
                    return [3 /*break*/, 4];
                case 3:
                    error_2 = _b.sent();
                    console.log("   \u274C \u5F02\u5E38: ".concat(error_2.message));
                    if (error_2.code) {
                        console.log("   \u9519\u8BEF\u4EE3\u7801: ".concat(error_2.code, "\n"));
                    }
                    return [2 /*return*/, false];
                case 4: return [2 /*return*/];
            }
        });
    });
}
// 运行测试
(function () { return __awaiter(void 0, void 0, void 0, function () {
    var result1, result2;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                console.log('\n开始测试...\n');
                return [4 /*yield*/, testLegacySwapAPI()];
            case 1:
                result1 = _a.sent();
                return [4 /*yield*/, testUltraAPI()];
            case 2:
                result2 = _a.sent();
                console.log('\n========================================');
                console.log('  测试结果');
                console.log('========================================');
                console.log("Legacy Swap API: ".concat(result1 ? '✅ 通过' : '❌ 失败'));
                console.log("Ultra API:       ".concat(result2 ? '✅ 通过' : '❌ 失败'));
                console.log('\n如果测试通过，您可以运行闪电贷机器人了！');
                console.log('========================================\n');
                return [2 /*return*/];
        }
    });
}); })().catch(function (error) {
    console.error('Fatal error:', error);
    process.exit(1);
});
