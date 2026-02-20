import { Component } from '@angular/core';

@Component({
    selector: 'app-test-page',
    standalone: true,
    template: `
    <div style="background: #00ff00; color: #000; padding: 100px; font-size: 48px; font-weight: bold; text-align: center; min-height: 100vh;">
      ✅ TEST PAGE WORKS!<br>
      <br>
      If you see this, routing is working.<br>
      <br>
      <a href="/command-center/dashboard" style="color: #0000ff; text-decoration: underline;">
        Click here to try Command Center Dashboard
      </a>
    </div>
  `
})
export class TestPageComponent { }
