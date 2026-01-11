import { Timestamp } from '@angular/fire/firestore';

export type BacklogStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'backlog';
export type BacklogPriority = 'low' | 'medium' | 'high' | 'critical';
export type BacklogType = 'feature' | 'bug' | 'task' | 'improvement';

export interface BacklogItem {
    id?: string;
    title: string;
    description: string;
    status: BacklogStatus;
    priority: BacklogPriority;
    type: BacklogType;
    assignee?: string;
    createdAt: Date;
    updatedAt: Date;
    tags?: string[];
    createdBy?: string;
}
