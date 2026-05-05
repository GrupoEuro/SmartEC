const mtdSales = 21529.31;
const mtdOrders = 26;
const mtdPieces = 26; // guess
const totalDaysInMonth = 31;
const fractionalDay = 0.9965277777777778; // 23:55 on May 1st

// If we don't have LY data available in the local script, the fallback is the straight-line average:
const projectedSales = (mtdSales / fractionalDay) * totalDaysInMonth;
const projectedOrders = Math.round((mtdOrders / fractionalDay) * totalDaysInMonth);
const projectedPieces = Math.round((mtdPieces / fractionalDay) * totalDaysInMonth);

console.log("Straight-line fallback predictions:");
console.log({ projectedSales, projectedOrders, projectedPieces });
