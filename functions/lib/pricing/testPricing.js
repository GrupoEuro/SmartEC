"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const PricingService_1 = require("./PricingService");
console.log("--- Testing PricingService ---");
// Test Floor Price
const floor = PricingService_1.PricingService.calculateFloorPrice(100, 1.2);
console.log("Floor Price (100 * 1.2) = ", floor, floor === 120 ? "PASS" : "FAIL");
// Test Final List Price
// Base Cost = 100, Floor Margin = 20, Shipping = 50, Fixed Fees = 10 (Total Numerator = 180)
// Commission = 0.15 (15%), Discounts = 0.05 (5%) (Total Denom = 1 - 0.20 = 0.80)
// 180 / 0.80 = 225
const finalList = PricingService_1.PricingService.calculateFinalListPrice(100, 20, 50, 10, 0.15, 0.05);
console.log("Final List Price (180 / 0.8) = ", finalList, finalList === 225 ? "PASS" : "FAIL");
// Test Prorating
const items = [
    { id: 'item1', volume: 10, weight: 5 },
    { id: 'item2', volume: 30, weight: 15 }
];
const byVolume = PricingService_1.PricingService.distributeInboundFreight(100, items, 'volume');
// Total volume = 40. item1 = 10/40 = 25%. item2 = 30/40 = 75%.
// Freight = 100. item1 = 25, item2 = 75.
console.log("Prorate Volume (100 freight, 1:3 ratio): ", byVolume);
console.log("PASS if item1 is 25 and item2 is 75");
const byWeight = PricingService_1.PricingService.distributeInboundFreight(50, items, 'weight');
// Total weight = 20. item1 = 5/20 = 25%. item2 = 15/20 = 75%.
// Freight = 50. item1 = 12.5, item2 = 37.5.
console.log("Prorate Weight (50 freight, 1:3 ratio): ", byWeight);
console.log("PASS if item1 is 12.5 and item2 is 37.5");
//# sourceMappingURL=testPricing.js.map