import { Injectable, inject } from '@angular/core';
import { Firestore, collection, getDocs, query, where, orderBy, limit } from '@angular/fire/firestore';
import { Observable, from, forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';

export interface DashboardStats {
    users: {
        total: number;
        active: number;
        inactive: number;
    };
    posts: {
        total: number;
        published: number;
        draft: number;
    };
    pdfs: {
        total: number;
        public: number;
        private: number;
    };
    banners: {
        total: number;
        active: number;
        inactive: number;
    };
    distributors: {
        total: number;
        new: number;
        contacted: number;
        converted: number;
    };
    newsletter: {
        total: number;
    };
}

export interface RecentActivity {
    id: string;
    action: string;
    module: string;
    details: string;
    userEmail: string;
    timestamp: Date;
}

@Injectable({
    providedIn: 'root'
})
export class DashboardStatsService {
    private firestore = inject(Firestore);

    getStats(): Observable<DashboardStats> {
        return forkJoin({
            users: from(this.getUserStats()),
            posts: from(this.getPostStats()),
            pdfs: from(this.getPdfStats()),
            banners: from(this.getBannerStats()),
            distributors: from(this.getDistributorStats()),
            newsletter: from(this.getNewsletterStats())
        });
    }

    private async getUserStats() {
        const usersCol = collection(this.firestore, 'users');
        const snapshot = await getDocs(usersCol);

        let active = 0;
        let inactive = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data['isActive']) active++;
            else inactive++;
        });

        return {
            total: snapshot.size,
            active,
            inactive
        };
    }

    private async getPostStats() {
        const postsCol = collection(this.firestore, 'posts');
        const snapshot = await getDocs(postsCol);

        let published = 0;
        let draft = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data['status'] === 'published') published++;
            else draft++;
        });

        return {
            total: snapshot.size,
            published,
            draft
        };
    }

    private async getPdfStats() {
        const pdfsCol = collection(this.firestore, 'pdfs');
        const snapshot = await getDocs(pdfsCol);

        let publicCount = 0;
        let privateCount = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data['isPublic']) publicCount++;
            else privateCount++;
        });

        return {
            total: snapshot.size,
            public: publicCount,
            private: privateCount
        };
    }

    private async getBannerStats() {
        const bannersCol = collection(this.firestore, 'banners');
        const snapshot = await getDocs(bannersCol);

        let active = 0;
        let inactive = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data['active']) active++;
            else inactive++;
        });

        return {
            total: snapshot.size,
            active,
            inactive
        };
    }

    private async getDistributorStats() {
        const distributorsCol = collection(this.firestore, 'distributors');
        const snapshot = await getDocs(distributorsCol);

        let newCount = 0;
        let contacted = 0;
        let converted = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            const status = data['status'] || 'new';
            if (status === 'new') newCount++;
            else if (status === 'contacted') contacted++;
            else if (status === 'converted') converted++;
        });

        return {
            total: snapshot.size,
            new: newCount,
            contacted,
            converted
        };
    }

    private async getNewsletterStats() {
        const newsletterCol = collection(this.firestore, 'newsletter');
        const snapshot = await getDocs(newsletterCol);

        return {
            total: snapshot.size
        };
    }

    getRecentActivity(limitCount: number = 10): Observable<RecentActivity[]> {
        const logsCol = collection(this.firestore, 'admin_logs');
        const q = query(logsCol, orderBy('timestamp', 'desc'), limit(limitCount));

        return from(getDocs(q)).pipe(
            map(snapshot => {
                const activities: RecentActivity[] = [];
                snapshot.forEach(doc => {
                    const data = doc.data();
                    activities.push({
                        id: doc.id,
                        action: data['action'],
                        module: data['module'],
                        details: data['details'],
                        userEmail: data['userEmail'],
                        timestamp: data['timestamp']?.toDate() || new Date()
                    });
                });
                return activities;
            })
        );
    }
}
