import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-faq',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './faq.component.html',
  styleUrl: './faq.component.css'
})
export class FaqComponent {
  activeIndex: number | null = null;
  showAll = false;

  allFaqs = [
    { icon: '❓', questionKey: 'FAQ.Q1', answerKey: 'FAQ.A1' },
    { icon: '💳', questionKey: 'FAQ.Q2', answerKey: 'FAQ.A2' },
    { icon: '🚚', questionKey: 'FAQ.Q3', answerKey: 'FAQ.A3' },
    { icon: '⏱️', questionKey: 'FAQ.Q4', answerKey: 'FAQ.A4' },
    { icon: '💰', questionKey: 'FAQ.Q5', answerKey: 'FAQ.A5' },
    { icon: '🤝', questionKey: 'FAQ.Q6', answerKey: 'FAQ.A6' },
    { icon: '🛡️', questionKey: 'FAQ.Q7', answerKey: 'FAQ.A7' },
    { icon: '🏍️', questionKey: 'FAQ.Q8', answerKey: 'FAQ.A8' },
    { icon: '📦', questionKey: 'FAQ.Q9', answerKey: 'FAQ.A9' },
    { icon: '🏭', questionKey: 'FAQ.Q10', answerKey: 'FAQ.A10' }
  ];

  get displayedFaqs() {
    return this.showAll ? this.allFaqs : this.allFaqs.slice(0, 6);
  }

  toggle(index: number) {
    this.activeIndex = this.activeIndex === index ? null : index;
  }

  toggleMore() {
    this.showAll = !this.showAll;
    if (!this.showAll) {
      // Scroll back up to start of list if collapsing
      // keeping it simple for now
    }
  }
}
