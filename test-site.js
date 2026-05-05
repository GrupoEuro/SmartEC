const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('CONSOLE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));

  console.log('Loading home page...');
  await page.goto('https://importadoraeuro.com/', { waitUntil: 'networkidle2' });
  console.log('Home page loaded.');

  console.log('Loading /blog...');
  await page.goto('https://importadoraeuro.com/blog', { waitUntil: 'networkidle2' });
  console.log('/blog loaded.');

  console.log('Loading /praxis...');
  await page.goto('https://importadoraeuro.com/praxis', { waitUntil: 'networkidle2' });
  console.log('/praxis loaded.');

  await browser.close();
})();
