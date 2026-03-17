const mockOrders = [
    {
        id: 'JAN_ORDER',
        createdAt: '2026-01-20T10:00:00Z',
        updatedAt: '2026-01-20T10:15:00Z',
        status: 'delivered',
        total: 200000 // 200k
    },
    {
        id: 'FEB_ORDER',
        createdAt: '2026-02-15T15:30:00Z',
        updatedAt: '2026-02-15T18:00:00Z',
        status: 'shipped',
        total: 300000 // 300k
    },
    {
        id: 'MAR_ORDER',
        createdAt: '2026-03-10T09:15:00Z',
        updatedAt: '2026-03-10T09:15:00Z',
        status: 'pending',
        total: 400000 // 400k
    }
];

// Helper functions injected from operations-dashboard.component.ts
function getJsDate(timestamp) {
    if (!timestamp) return new Date();
    return timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
}

const today = new Date('2026-03-14T12:00:00Z');
today.setHours(0, 0, 0, 0);

// --- calculateStats() simulation ---
let sales = 0;
mockOrders.forEach(o => {
    if (o.status !== 'cancelled' && o.status !== 'refunded' && o.status !== 'returned') {
        sales += o.total || 0;
    }
});
console.log("Widget Total Sales:", sales); // Expecting 900,000


// --- createTrendChart() simulation ---
const currentYear = today.getFullYear();
const currentMonthIndex = today.getMonth(); // 2
const dataLength = currentMonthIndex + 1; // 3
const salesData = new Array(dataLength).fill(0);

const getIndexFn = (d) => {
    if (d.getFullYear() === currentYear) {
        return d.getMonth();
    }
    return -1;
};

mockOrders.forEach(o => {
    const orderDate = getJsDate(o.createdAt || o.updatedAt);
    const index = getIndexFn(orderDate);
    
    if (index >= 0 && index < dataLength) {
        if (o.status !== 'cancelled' && o.status !== 'refunded' && o.status !== 'returned' && o.status !== 'invalid') {
            salesData[index] += o.total || 0;
        }
    }
});

console.log("Chart Array Total Sales:", salesData.reduce((a, b) => a + b, 0));
console.log("Chart Sales Array:", salesData);
