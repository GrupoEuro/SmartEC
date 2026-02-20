import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-why-it',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './why-it.component.html',
  styleUrl: './why-it.component.css'
})
export class WhyItComponent {
  cards = [
    { icon: '🎯', titleKey: 'Why.CARD_1_TITLE', descKey: 'WHY.CARD_1_DESC' },
    { icon: '💲', titleKey: 'Why.CARD_2_TITLE', descKey: 'WHY.CARD_2_DESC' },
    { icon: '📦', titleKey: 'Why.CARD_3_TITLE', descKey: 'WHY.CARD_3_DESC' },
    { icon: '🚛', titleKey: 'Why.CARD_4_TITLE', descKey: 'WHY.CARD_4_DESC' },
    { icon: '👨‍💼', titleKey: 'Why.CARD_5_TITLE', descKey: 'WHY.CARD_5_DESC' },
    { icon: '🛡️', titleKey: 'Why.CARD_6_TITLE', descKey: 'WHY.CARD_6_DESC' }
  ];

  steps = [
    { number: 1, icon: '📞', titleKey: 'WHY.STEP_1_TITLE', descKey: 'WHY.STEP_1_DESC' },
    { number: 2, icon: '📋', titleKey: 'WHY.STEP_2_TITLE', descKey: 'WHY.STEP_2_DESC' },
    { number: 3, icon: '💳', titleKey: 'WHY.STEP_3_TITLE', descKey: 'WHY.STEP_3_DESC' },
    { number: 4, icon: '📦', titleKey: 'WHY.STEP_4_TITLE', descKey: 'WHY.STEP_4_DESC' }
  ];
}
