const mPrice = undefined;
const pPrice = 100;
const pCost = 0;
const finalCost = pCost > 0 ? pCost : ((mPrice > 0 ? mPrice : pPrice) * 0.7);
console.log("finalCost:", finalCost);

const stockQuantity = Number(undefined) || Number(null) || 0;
console.log("stockQuantity:", stockQuantity);
