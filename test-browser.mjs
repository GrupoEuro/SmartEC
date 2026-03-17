import puppeteer from 'puppeteer';
(async () => {
    try {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        let hasErrors = false;
        
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.log('[BROWSER ERROR]', msg.text());
                hasErrors = true;
            }
        });
        
        page.on('pageerror', error => {
            console.log('[PAGE ERROR]', error.message);
            hasErrors = true;
        });
        
        console.log('Navigating to localhost:4200/operations/orders...');
        await page.goto('http://localhost:4200/operations/orders', { waitUntil: 'networkidle2' });
        
        if (!hasErrors) console.log('Success, no crashes detected.');
        await browser.close();
    } catch (e) {
        console.error('Puppeteer Script Error:', e);
        process.exit(1);
    }
})();
