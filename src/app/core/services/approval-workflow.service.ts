import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, query, where, orderBy, getDocs, updateDoc, doc, getDoc, Timestamp, onSnapshot, deleteDoc } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import { CouponService } from './coupon.service';
import { UserManagementService } from './user-management.service';
import {
    ApprovalRequest,
    ApprovalRequestType,
    ApprovalStatus,
    ApprovalThreshold,
    ApprovalPriority,
    CouponApprovalData,
    PriceChangeData,
    BulkDiscountData,
    FlashSaleData,
    PromotionApprovalData
} from '../models/approval-request.model';

@Injectable({
    providedIn: 'root'
})
export class ApprovalWorkflowService {
    private firestore = inject(Firestore);
    private authService = inject(AuthService);
    private notificationService = inject(NotificationService);
    private couponService = inject(CouponService);
    private userService = inject(UserManagementService);

    private approvalsCollection = collection(this.firestore, 'approval_requests');

    // Configurable approval thresholds
    private thresholds: ApprovalThreshold[] = [
        {
            type: 'COUPON_CREATION',
            autoApproveConditions: {
                maxDiscountPercentage: 15,
                maxFixedAmount: 500
            },
            requiresApproval: true,
            notifyOnAutoApprove: true,
            expirationHours: 48
        },
        {
            type: 'FLASH_SALE',
            requiresApproval: true,
            notifyOnAutoApprove: false,
            expirationHours: 24
        },
        {
            type: 'PRICE_CHANGE',
            autoApproveConditions: {
                maxPriceChangePercentage: 10
            },
            requiresApproval: true,
            notifyOnAutoApprove: true,
            expirationHours: 72
        },
        {
            type: 'BULK_DISCOUNT',
            autoApproveConditions: {
                maxDiscountPercentage: 10
            },
            requiresApproval: true,
            notifyOnAutoApprove: true,
            expirationHours: 48
        },
        {
            type: 'PROMOTION_CREATION',
            autoApproveConditions: {
                maxDiscountPercentage: 20
            },
            requiresApproval: true,
            notifyOnAutoApprove: true,
            expirationHours: 48
        }
    ];

    /**
     * Create a new approval request
     */
    async createApprovalRequest(
        type: ApprovalRequestType,
        data: any,
        notes?: string,
        priority?: ApprovalPriority
    ): Promise<ApprovalRequest> {
        const currentUser = await this.authService.getCurrentUser();
        if (!currentUser) {
            throw new Error('User not authenticated');
        }

        // Check if auto-approval is possible
        const canAutoApprove = this.canAutoApprove(type, data);
        const threshold = this.thresholds.find(t => t.type === type);

        // Calculate expiration
        const expiresAt = threshold?.expirationHours
            ? Timestamp.fromMillis(Date.now() + threshold.expirationHours * 60 * 60 * 1000)
            : undefined;

        const request: Omit<ApprovalRequest, 'id'> = {
            type,
            status: canAutoApprove ? 'APPROVED' : 'PENDING',
            requestedBy: {
                uid: currentUser.uid,
                name: currentUser.displayName || currentUser.email || 'Unknown',
                email: currentUser.email || '',
                role: currentUser.role
            },
            requestedAt: Timestamp.now(),
            data,
            priority: priority || this.calculatePriority(type, data),
            notes,
            expiresAt,
            autoApproved: canAutoApprove
        };

        const docRef = await addDoc(this.approvalsCollection, request);
        const createdRequest = { id: docRef.id, ...request } as ApprovalRequest;

        if (canAutoApprove) {
            // Execute auto-approved action
            await this.executeApprovedAction(createdRequest);

            // Notify if configured
            if (threshold?.notifyOnAutoApprove) {
                await this.notifyAutoApproval(createdRequest);
            }
        } else {
            // Notify managers
            await this.notifyManagers(createdRequest);
        }

        return createdRequest;
    }

    /**
     * Check if request can be auto-approved
     */
    canAutoApprove(type: ApprovalRequestType, data: any): boolean {
        const threshold = this.thresholds.find(t => t.type === type);
        if (!threshold || !threshold.autoApproveConditions) {
            return false;
        }

        const conditions = threshold.autoApproveConditions;

        switch (type) {
            case 'COUPON_CREATION':
                const couponData = data as CouponApprovalData;
                if (couponData.type === 'percentage') {
                    return couponData.value <= (conditions.maxDiscountPercentage || 0);
                } else {
                    return couponData.value <= (conditions.maxFixedAmount || 0);
                }

            case 'PRICE_CHANGE':
                const priceData = data as PriceChangeData;
                return Math.abs(priceData.changePercentage) <= (conditions.maxPriceChangePercentage || 0);

            case 'BULK_DISCOUNT':
                const bulkData = data as BulkDiscountData;
                return bulkData.discountPercentage <= (conditions.maxDiscountPercentage || 0);

            case 'PROMOTION_CREATION':
                const promoData = data as PromotionApprovalData;
                return promoData.discountPercentage <= (conditions.maxDiscountPercentage || 0);

            case 'FLASH_SALE':
                return false;  // Flash sales always require approval

            default:
                return false;
        }
    }

    /**
     * Calculate priority based on request type and data
     */
    private calculatePriority(type: ApprovalRequestType, data: any): ApprovalPriority {
        switch (type) {
            case 'FLASH_SALE':
                return 'URGENT';

            case 'COUPON_CREATION':
                const couponData = data as CouponApprovalData;
                if (couponData.type === 'percentage' && couponData.value > 30) {
                    return 'HIGH';
                }
                return 'NORMAL';

            case 'PRICE_CHANGE':
                const priceData = data as PriceChangeData;
                if (Math.abs(priceData.changePercentage) > 25) {
                    return 'HIGH';
                }
                return 'NORMAL';

            case 'BULK_DISCOUNT':
                const bulkData = data as BulkDiscountData;
                if (bulkData.productCount > 50 || bulkData.discountPercentage > 20) {
                    return 'HIGH';
                }
                return 'NORMAL';

            default:
                return 'NORMAL';
        }
    }

    /**
     * Get pending approval requests
     */
    getPendingRequests(): Observable<ApprovalRequest[]> {
        return new Observable(observer => {
            const q = query(
                this.approvalsCollection,
                where('status', '==', 'PENDING'),
                orderBy('requestedAt', 'desc')
            );

            const unsubscribe = onSnapshot(q, (snapshot) => {
                const requests: ApprovalRequest[] = [];
                snapshot.forEach(doc => {
                    requests.push({
                        id: doc.id,
                        ...doc.data()
                    } as ApprovalRequest);
                });
                observer.next(requests);
            }, (error) => {
                observer.error(error);
            });

            return () => unsubscribe();
        });
    }

    /**
     * Get approval requests by date range (optimized for dashboard)
     */
    getRequestsByDateRange(startDate: Date, endDate: Date, status?: ApprovalStatus): Observable<ApprovalRequest[]> {
        return new Observable(observer => {
            let q = query(
                this.approvalsCollection,
                where('requestedAt', '>=', Timestamp.fromDate(startDate)),
                where('requestedAt', '<=', Timestamp.fromDate(endDate)),
                orderBy('requestedAt', 'desc')
            );

            getDocs(q).then(snapshot => {
                const requests: ApprovalRequest[] = [];
                snapshot.forEach(doc => {
                    const data = doc.data();
                    // Filter by status if provided (client-side since we can't have 3 where clauses)
                    if (!status || data['status'] === status) {
                        requests.push({
                            id: doc.id,
                            ...data
                        } as ApprovalRequest);
                    }
                });

                console.log(`[ApprovalService] Fetched ${requests.length} requests for date range`);
                observer.next(requests);
                observer.complete();
            }).catch(error => {
                console.error('[ApprovalService] Error fetching requests:', error);
                observer.next([]); // Return empty array on error
                observer.complete();
            });

            return () => { }; // No cleanup needed for getDocs
        });
    }

    /**
     * Get requests by status
     */
    getRequestsByStatus(status: ApprovalStatus): Observable<ApprovalRequest[]> {
        return new Observable(observer => {
            const q = query(
                this.approvalsCollection,
                where('status', '==', status),
                orderBy('requestedAt', 'desc')
            );

            const unsubscribe = onSnapshot(q, (snapshot) => {
                const requests: ApprovalRequest[] = [];
                snapshot.forEach(doc => {
                    requests.push({
                        id: doc.id,
                        ...doc.data()
                    } as ApprovalRequest);
                });
                observer.next(requests);
            }, (error) => {
                observer.error(error);
            });

            return () => unsubscribe();
        });
    }

    /**
     * Get user's requests
     */
    getUserRequests(uid: string): Observable<ApprovalRequest[]> {
        return new Observable(observer => {
            const q = query(
                this.approvalsCollection,
                where('requestedBy.uid', '==', uid),
                orderBy('requestedAt', 'desc')
            );

            const unsubscribe = onSnapshot(q, (snapshot) => {
                const requests: ApprovalRequest[] = [];
                snapshot.forEach(doc => {
                    requests.push({
                        id: doc.id,
                        ...doc.data()
                    } as ApprovalRequest);
                });
                observer.next(requests);
            }, (error) => {
                observer.error(error);
            });

            return () => unsubscribe();
        });
    }

    /**
     * Get single approval request
     */
    async getApprovalRequest(id: string): Promise<ApprovalRequest | null> {
        const docRef = doc(this.firestore, 'approval_requests', id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return {
                id: docSnap.id,
                ...docSnap.data()
            } as ApprovalRequest;
        }

        return null;
    }

    /**
     * Approve request
     */
    async approveRequest(requestId: string, reviewerNotes?: string): Promise<void> {
        const currentUser = await this.authService.getCurrentUser();
        if (!currentUser) {
            throw new Error('User not authenticated');
        }

        const request = await this.getApprovalRequest(requestId);
        if (!request) {
            throw new Error('Approval request not found');
        }

        if (request.status !== 'PENDING') {
            throw new Error('Request is not pending');
        }

        const requestRef = doc(this.firestore, 'approval_requests', requestId);
        await updateDoc(requestRef, {
            status: 'APPROVED',
            reviewedBy: {
                uid: currentUser.uid,
                name: currentUser.displayName || currentUser.email || 'Unknown',
                email: currentUser.email || ''
            },
            reviewedAt: Timestamp.now(),
            reviewerNotes
        });

        // Execute the approved action
        const updatedRequest = await this.getApprovalRequest(requestId);
        if (updatedRequest) {
            await this.executeApprovedAction(updatedRequest);
            await this.notifyRequester(updatedRequest, true);
        }
    }

    /**
     * Reject request
     */
    async rejectRequest(requestId: string, reason: string): Promise<void> {
        const currentUser = await this.authService.getCurrentUser();
        if (!currentUser) {
            throw new Error('User not authenticated');
        }

        const request = await this.getApprovalRequest(requestId);
        if (!request) {
            throw new Error('Approval request not found');
        }

        if (request.status !== 'PENDING') {
            throw new Error('Request is not pending');
        }

        const requestRef = doc(this.firestore, 'approval_requests', requestId);
        await updateDoc(requestRef, {
            status: 'REJECTED',
            reviewedBy: {
                uid: currentUser.uid,
                name: currentUser.displayName || currentUser.email || 'Unknown',
                email: currentUser.email || ''
            },
            reviewedAt: Timestamp.now(),
            rejectionReason: reason
        });

        // Notify requester
        const updatedRequest = await this.getApprovalRequest(requestId);
        if (updatedRequest) {
            await this.notifyRequester(updatedRequest, false);
        }
    }

    /**
     * Cancel request (by requester)
     */
    async cancelRequest(requestId: string): Promise<void> {
        const currentUser = await this.authService.getCurrentUser();
        if (!currentUser) {
            throw new Error('User not authenticated');
        }

        const request = await this.getApprovalRequest(requestId);
        if (!request) {
            throw new Error('Approval request not found');
        }

        if (request.requestedBy.uid !== currentUser.uid) {
            throw new Error('Only the requester can cancel this request');
        }

        if (request.status !== 'PENDING') {
            throw new Error('Only pending requests can be cancelled');
        }

        const requestRef = doc(this.firestore, 'approval_requests', requestId);
        await updateDoc(requestRef, {
            status: 'CANCELLED'
        });
    }

    /**
     * Execute approved action
     */
    private async executeApprovedAction(request: ApprovalRequest): Promise<void> {
        switch (request.type) {
            case 'COUPON_CREATION':
                await this.executeCouponCreation(request.data as CouponApprovalData);
                break;

            // Other types will be implemented as we integrate
            case 'PRICE_CHANGE':
            case 'BULK_DISCOUNT':
            case 'FLASH_SALE':
            case 'PROMOTION_CREATION':
                console.log(`Execution for ${request.type} not yet implemented`);
                break;
        }
    }

    /**
     * Execute coupon creation
     */
    private async executeCouponCreation(data: CouponApprovalData): Promise<void> {
        await this.couponService.createCoupon({
            code: data.code,
            type: data.type,
            value: data.value,
            description: data.description,
            usageLimit: data.usageLimit,
            usageCount: 0,
            isActive: true,
            startDate: data.startDate,
            endDate: data.endDate,
            minPurchaseAmount: data.minPurchaseAmount,
            applicableProducts: data.applicableProducts,
            applicableCategories: data.applicableCategories
        } as any);
    }

    /**
     * Notify managers about new approval request
     */
    private async notifyManagers(request: ApprovalRequest): Promise<void> {
        // Get all MANAGER and SUPER_ADMIN users
        const managers = await this.userService.getUsersByRole(['SUPER_ADMIN', 'MANAGER']);
        const managerIds = managers.map(m => m.uid);

        if (managerIds.length === 0) {
            console.warn('No managers found to notify');
            return;
        }

        const title = `New ${this.getRequestTypeLabel(request.type)} Request`;
        const message = this.getRequestMessage(request);

        await this.notificationService.notifyManagers(
            title,
            message,
            request.id,
            managerIds
        );
    }

    /**
     * Notify requester about decision
     */
    private async notifyRequester(request: ApprovalRequest, approved: boolean): Promise<void> {
        const title = approved
            ? `${this.getRequestTypeLabel(request.type)} Approved`
            : `${this.getRequestTypeLabel(request.type)} Rejected`;

        const message = approved
            ? `Your ${this.getRequestTypeLabel(request.type).toLowerCase()} request has been approved.`
            : `Your ${this.getRequestTypeLabel(request.type).toLowerCase()} request has been rejected. Reason: ${request.rejectionReason}`;

        await this.notificationService.notifyRequester(
            request.requestedBy.uid,
            title,
            message,
            approved,
            request.id
        );
    }

    /**
     * Notify about auto-approval
     */
    private async notifyAutoApproval(request: ApprovalRequest): Promise<void> {
        const managers = await this.userService.getUsersByRole(['SUPER_ADMIN', 'MANAGER']);
        const managerIds = managers.map(m => m.uid);

        const title = `${this.getRequestTypeLabel(request.type)} Auto-Approved`;
        const message = `A ${this.getRequestTypeLabel(request.type).toLowerCase()} was automatically approved based on threshold rules.`;

        await this.notificationService.notifyManagers(
            title,
            message,
            request.id,
            managerIds
        );
    }

    /**
     * Get human-readable request type label
     */
    private getRequestTypeLabel(type: ApprovalRequestType): string {
        const labels: Record<ApprovalRequestType, string> = {
            'COUPON_CREATION': 'Coupon Creation',
            'PROMOTION_CREATION': 'Promotion Creation',
            'PRICE_CHANGE': 'Price Change',
            'BULK_DISCOUNT': 'Bulk Discount',
            'FLASH_SALE': 'Flash Sale'
        };
        return labels[type];
    }

    /**
     * Get request message for notification
     */
    private getRequestMessage(request: ApprovalRequest): string {
        switch (request.type) {
            case 'COUPON_CREATION':
                const coupon = request.data as CouponApprovalData;
                return `${coupon.code} - ${coupon.type === 'percentage' ? coupon.value + '%' : '$' + coupon.value} discount`;

            case 'PRICE_CHANGE':
                const price = request.data as PriceChangeData;
                return `${price.productName} - ${price.changePercentage > 0 ? '+' : ''}${price.changePercentage.toFixed(1)}% price change`;

            default:
                return 'Review required';
        }
    }
}
