const puppeteer = require('puppeteer');
(async () => {
    try {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        
        page.on('console', msg => {
            if (msg.type() === 'error') console.log('[BROWSER ERROR]', msg.text());
            else console.log('[BROWSER LOG]', msg.text());
        });
        
        page.on('pageerror', error => {
            console.log('[PAGE ERROR]', error.message);
        });
        
        console.log('Navigating to localhost:4200/operations/orders...');
        await page.goto('http://localhost:4200/operations/orders', { waitUntil: 'networkidle2' });
        
        console.log('Success, no crashes detected script side.');
        await browser.close();
    } catch (e) {
        console.error('Puppeteer Script Error:', e);
        process.exit(1);
    }
})();
