import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChannelRevenueWidgetComponent } from './widgets/channel-revenue-widget/channel-revenue-widget.component';
import { MarketingRoiWidgetComponent } from './widgets/marketing-roi-widget/marketing-roi-widget.component';
import { StockoutPredictionWidgetComponent } from './widgets/stockout-prediction-widget/stockout-prediction-widget.component';
import { InboundLogisticsWidgetComponent } from './widgets/inbound-logistics-widget/inbound-logistics-widget.component';
import { UnifiedCrmWidgetComponent } from './widgets/unified-crm-widget/unified-crm-widget.component';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { CommandCenterContextService } from '../services/command-center-context.service';
import { DashboardDiagnosticsComponent } from '../../../shared/components/dashboard-diagnostics/dashboard-diagnostics.component';

@Component({
    selector: 'app-mission-control',
    standalone: true,
    imports: [
        CommonModule,
        ChannelRevenueWidgetComponent,
        MarketingRoiWidgetComponent,
        StockoutPredictionWidgetComponent,
        InboundLogisticsWidgetComponent,
        UnifiedCrmWidgetComponent,
        AppIconComponent,
        DashboardDiagnosticsComponent
    ],
    templateUrl: './mission-control.component.html',
    styleUrls: ['./mission-control.component.css']
})
export class MissionControlComponent {
    public contextService = inject(CommandCenterContextService);

    get activeChannelLabel() {
        const channels = this.contextService.selectedChannels();
        if (channels.length === 0) return 'All Channels';
        if (channels.length === 1) {
            return this.contextService.availableChannels.find((c: any) => c.id === channels[0])?.label || 'Unknown';
        }
        return `${channels.length} Selected`;
    }

    selectChannel(id: string | null) {
        this.contextService.toggleChannel(id);
    }
}
