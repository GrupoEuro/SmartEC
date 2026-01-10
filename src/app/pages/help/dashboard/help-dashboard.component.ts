import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { HelpContentService, HelpTopic } from '../services/help-content.service';
import { Observable } from 'rxjs';
import { HelpHeaderComponent } from '../components/help-header/help-header.component';

@Component({
  selector: 'app-help-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, HelpHeaderComponent],
  template: `
    <div class="help-page-container">
      <app-help-header></app-help-header>
      
      <!-- Hero Section -->
      <div class="help-hero">
         <div class="hero-content">
            <h1>How can we <span class="highlight">help you?</span></h1>
            <p>Explore our comprehensive guides and standard operating procedures.</p>
         </div>
      </div>

      <!-- Categories & Topics -->
      <div class="topics-container">
        <div class="tools-grid">
            <a routerLink="/help/glossary" class="tool-card glossary">
                <div class="icon-box">📚</div>
                <div class="tool-info">
                    <h3>Glossary</h3>
                    <p>Business terms & formulas</p>
                </div>
                <span class="arrow">→</span>
            </a>
        </div>

        <div class="topic-grid">
          <a *ngFor="let topic of topics$ | async" 
             [routerLink]="['/help/topic', topic.id]"
             class="topic-card">
             
             <div class="card-icon">
                <!-- SVG Icon Mapping -->
                <ng-container [ngSwitch]="topic.icon">
                  <svg *ngSwitchCase="'box'" xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <svg *ngSwitchCase="'clipboard'" xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <svg *ngSwitchDefault xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </ng-container>
             </div>

             <div class="card-content">
                <span class="category-badge">{{topic.category}}</span>
                <h3>{{topic.title}}</h3>
                <p>{{topic.description}}</p>
             </div>

             <div class="card-footer">
               Learn more 
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
               </svg>
             </div>
          </a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      background-color: #0f172a; /* Slate 900 */
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      color: #e2e8f0; /* Slate 200 */
    }

    .help-page-container {
      width: 100%;
    }

    /* Hero Section */
    .help-hero {
      background: linear-gradient(to bottom, #0f172a, #112533);
      padding: 4rem 1rem 3rem 1rem;
      text-align: center;
      border-bottom: 1px solid #1e293b;
      position: relative;
    }

    .hero-content h1 {
      font-size: 3rem;
      font-weight: 800;
      color: #fff;
      margin-bottom: 1rem;
      letter-spacing: -0.025em;
    }

    .highlight {
      background: linear-gradient(to right, #2dd4bf, #0ea5e9);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      color: #2dd4bf;
    }

    .hero-content p {
      font-size: 1.25rem;
      color: #94a3b8; /* Slate 400 */
      max-width: 600px;
      margin: 0 auto;
    }

    /* Topics Grid */
    .topics-container {
      max-width: 1200px;
      margin: 3rem auto;
      padding: 0 2rem;
      position: relative;
      z-index: 10;
    }

    /* Tools Grid */
    .tools-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 1.5rem;
        margin-bottom: 3rem;
    }

    .tool-card {
        display: flex;
        align-items: center;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 16px;
        padding: 1.5rem;
        text-decoration: none;
        color: inherit;
        transition: all 0.2s;
    }

    .tool-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
        border-color: #475569;
    }

    .tool-card.glossary:hover {
        border-color: #a78bfa; /* Apps/Philosophy color */
        background: linear-gradient(145deg, #1e293b, #2e1065);
    }

    .tool-card .icon-box {
        font-size: 2rem;
        margin-right: 1rem;
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 12px;
    }

    .tool-info h3 {
        margin: 0 0 0.25rem 0;
        font-size: 1.1rem;
        color: #f8fafc;
    }

    .tool-info p {
        margin: 0;
        font-size: 0.85rem;
        color: #94a3b8;
    }

    .arrow {
        margin-left: auto;
        color: #64748b;
        font-weight: 500;
        transition: transform 0.2s;
    }

    .tool-card:hover .arrow {
        transform: translateX(4px);
        color: #f8fafc;
    }

    .topic-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 2rem;
    }

    .topic-card {
      background-color: #1e293b; /* Slate 800 */
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 2rem;
      text-decoration: none;
      transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .topic-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
      border-color: #2dd4bf; /* Teal 400 */
    }

    .card-icon {
      width: 56px;
      height: 56px;
      background-color: #0f172a;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #2dd4bf; /* Teal 400 */
    }

    .category-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      background-color: #334155;
      color: #cbd5e1;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      margin-bottom: 0.5rem;
    }

    .topic-card h3 {
      font-size: 1.5rem;
      font-weight: 700;
      color: #fff;
      margin: 0 0 0.5rem 0;
    }

    .topic-card p {
      color: #94a3b8;
      font-size: 0.95rem;
      line-height: 1.5;
      margin: 0;
    }

    .card-footer {
      margin-top: auto;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #2dd4bf;
      font-weight: 600;
      font-size: 0.9rem;
    }
  `]
})
export class HelpDashboardComponent {
  private helpService = inject(HelpContentService);

  topics$: Observable<HelpTopic[]> = this.helpService.getTopics();
}
