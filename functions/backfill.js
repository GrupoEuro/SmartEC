"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
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
exports.__esModule = true;
var admin = __importStar(require("firebase-admin"));
if (!admin.apps.length) {
    admin.initializeApp();
}
var db = admin.firestore();
function backfill() {
    return __awaiter(this, void 0, void 0, function () {
        var year, month, currentDay, lyYear, dayRef, daySnap, mtdSales, mtdPieces, mtdOrders, data, monthSnap, data, totalDaysInMonth_1, lyDaysRef, lyDaysSnap, lyDailySales_1, hasLyData_1, todayIdx, fractionalDay, projectedSales, projectedPieces, projectedOrders, lySalesMTD, i, fractionalDayPart, velocityMultiplier, futureLySales, i, ratio, snapshotRef, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 7, , 8]);
                    console.log('Starting backfill for May 1st 2026...');
                    year = 2026;
                    month = '05';
                    currentDay = '01';
                    lyYear = 2025;
                    dayRef = db.collection('monthly_stats').doc("".concat(year, "-").concat(month)).collection('days').doc(currentDay);
                    return [4 /*yield*/, dayRef.get()];
                case 1:
                    daySnap = _a.sent();
                    mtdSales = 0;
                    mtdPieces = 0;
                    mtdOrders = 0;
                    if (!daySnap.exists) return [3 /*break*/, 2];
                    data = daySnap.data();
                    mtdSales = data.sales || 0;
                    mtdPieces = data.pieces || 0;
                    mtdOrders = data.orders || 0;
                    console.log("Found May 1st actuals: Sales $".concat(mtdSales, ", Pieces ").concat(mtdPieces, ", Orders ").concat(mtdOrders));
                    return [3 /*break*/, 4];
                case 2:
                    console.log("[backfill] Warning: No daily doc for ".concat(year, "-").concat(month, "/days/").concat(currentDay, ". Using current monthly_stats aggregate."));
                    return [4 /*yield*/, db.collection('monthly_stats').doc("".concat(year, "-").concat(month)).get()];
                case 3:
                    monthSnap = _a.sent();
                    data = monthSnap.data() || {};
                    mtdSales = data.sales || 0;
                    mtdPieces = data.pieces || 0;
                    mtdOrders = data.orders || 0;
                    _a.label = 4;
                case 4:
                    if (mtdSales <= 0) {
                        console.log("[backfill] No sales to project for ".concat(year, "-").concat(month, "-").concat(currentDay));
                        return [2 /*return*/];
                    }
                    totalDaysInMonth_1 = new Date(year, parseInt(month, 10), 0).getDate();
                    lyDaysRef = db.collection('monthly_stats').doc("".concat(lyYear, "-").concat(month)).collection('days');
                    return [4 /*yield*/, lyDaysRef.get()];
                case 5:
                    lyDaysSnap = _a.sent();
                    lyDailySales_1 = new Array(totalDaysInMonth_1).fill(0);
                    hasLyData_1 = false;
                    lyDaysSnap.forEach(function (doc) {
                        var dayNum = parseInt(doc.id, 10);
                        if (dayNum >= 1 && dayNum <= totalDaysInMonth_1) {
                            lyDailySales_1[dayNum - 1] = doc.data().sales || 0;
                            hasLyData_1 = true;
                        }
                    });
                    todayIdx = 0;
                    fractionalDay = todayIdx + (23 / 24) + (55 / 1440);
                    projectedSales = 0;
                    projectedPieces = 0;
                    projectedOrders = 0;
                    if (hasLyData_1 && lyDailySales_1.length === totalDaysInMonth_1) {
                        lySalesMTD = 0;
                        for (i = 0; i < todayIdx; i++)
                            lySalesMTD += lyDailySales_1[i];
                        fractionalDayPart = (23 / 24) + (55 / 1440);
                        lySalesMTD += lyDailySales_1[todayIdx] * fractionalDayPart;
                        if (lySalesMTD > 0) {
                            velocityMultiplier = mtdSales / lySalesMTD;
                            futureLySales = 0;
                            futureLySales += lyDailySales_1[todayIdx] * (1 - fractionalDayPart);
                            for (i = todayIdx + 1; i < totalDaysInMonth_1; i++) {
                                futureLySales += lyDailySales_1[i];
                            }
                            projectedSales = mtdSales + (futureLySales * velocityMultiplier);
                        }
                        else {
                            projectedSales = (mtdSales / fractionalDay) * totalDaysInMonth_1;
                        }
                    }
                    else {
                        projectedSales = (mtdSales / fractionalDay) * totalDaysInMonth_1;
                    }
                    if (projectedSales > 0 && mtdSales > 0) {
                        ratio = projectedSales / mtdSales;
                        projectedPieces = Math.round(mtdPieces * ratio);
                        projectedOrders = Math.round(mtdOrders * ratio);
                    }
                    else {
                        projectedPieces = Math.round((mtdPieces / fractionalDay) * totalDaysInMonth_1);
                        projectedOrders = Math.round((mtdOrders / fractionalDay) * totalDaysInMonth_1);
                    }
                    snapshotRef = db.collection('monthly_stats').doc("".concat(year, "-").concat(month)).collection('projections').doc(currentDay);
                    return [4 /*yield*/, snapshotRef.set({
                            predictedSales: projectedSales,
                            predictedPieces: projectedPieces,
                            predictedOrders: projectedOrders,
                            actualSalesAtSnapshot: mtdSales,
                            fractionalDay: fractionalDay,
                            timestamp: admin.firestore.FieldValue.serverTimestamp()
                        })];
                case 6:
                    _a.sent();
                    console.log("[backfill] Saved EOM projection for ".concat(year, "-").concat(month, "-").concat(currentDay, ": $").concat(projectedSales));
                    process.exit(0);
                    return [3 /*break*/, 8];
                case 7:
                    e_1 = _a.sent();
                    console.error(e_1);
                    process.exit(1);
                    return [3 /*break*/, 8];
                case 8: return [2 /*return*/];
            }
        });
    });
}
backfill();
