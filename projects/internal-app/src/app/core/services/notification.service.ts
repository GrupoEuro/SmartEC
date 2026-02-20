import { Injectable, inject } from '@angular/core';
import { Firestore, collection, query, where, orderBy, limit, addDoc, doc, updateDoc, collectionData, Timestamp } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable, map } from 'rxjs';
import { AppNotification } from '../models/notification.model';
import { AuthService } from './auth.service';

@Injectable({
    providedIn: 'root'
})
export class NotificationService {
    private firestore = inject(Firestore);
    private auth = inject(Auth);
    private authService = inject(AuthService);

    /**
     * Get a real-time stream of unread notifications for the system
     * In a more complex system, this would be filtered by userId or role
     */
    getUnreadNotifications(limitCount = 20): Observable<AppNotification[]> {
        const notificationsRef = collection(this.firestore, 'notifications');
        // Query: Unread notifications, ordered by newest first
        const q = query(
            notificationsRef,
            where('read', '==', false),
            orderBy('timestamp', 'desc'),
            limit(limitCount)
        );

        return collectionData(q, { idField: 'id' }).pipe(
            map(notifications => notifications.map(n => ({
                ...n,
                // Handle Firestore Timestamp conversion if needed
                timestamp: n['timestamp'] instanceof Timestamp ? n['timestamp'].toDate() : n['timestamp']
            })) as AppNotification[])
        );
    }

    /**
     * Mark a specific notification as active/read
     */
    async markAsRead(notificationId: string): Promise<void> {
        const docRef = doc(this.firestore, 'notifications', notificationId);
        await updateDoc(docRef, { read: true });
    }

    /**
     * Mark all visible notifications as read (Bulk action)
     */
    async markAllAsRead(notificationIds: string[]): Promise<void> {
        const batchPromises = notificationIds.map(id => this.markAsRead(id));
        await Promise.all(batchPromises);
    }

    /**
     * Create a new notification (to be used by other services)
     */
    async createNotification(notification: Omit<AppNotification, 'id' | 'timestamp' | 'read'>): Promise<string> {
        const notificationsRef = collection(this.firestore, 'notifications');
        const docRef = await addDoc(notificationsRef, {
            ...notification,
            timestamp: Timestamp.now(),
            read: false,
            createdBy: this.auth.currentUser?.uid || 'system'
        });
        return docRef.id;
    }

    /**
     * Notify managers (Used by Approval Workflow)
     */
    async notifyManagers(title: string, message: string, relatedId: string, recipientIds: string[]): Promise<void> {
        // Currently notifications are global, so we create one. 
        // In verify future, add userId filtering.
        await this.createNotification({
            type: 'info',
            title,
            message,
            link: `/admin/approvals/${relatedId}`,
            metadata: { recipientIds, relatedId }
        });
    }

    /**
     * Notify requester (Used by Approval Workflow)
     */
    async notifyRequester(userId: string, title: string, message: string, approved: boolean, relatedId: string): Promise<void> {
        await this.createNotification({
            type: approved ? 'success' : 'error',
            title,
            message,
            link: `/admin/approvals/${relatedId}`,
            metadata: { userId, relatedId }
        });
    }
}
