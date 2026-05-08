import { Injectable, inject } from '@angular/core';
import { Firestore, collection, getDocs, query, where, orderBy, limit, getCountFromServer } from '@angular/fire/firestore';
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

    // ✅ Uses getCountFromServer() — does NOT download documents, only returns count
    private async getUserStats() {
        const usersCol = collection(this.firestore, 'users');
        const [total, active] = await Promise.all([
            getCountFromServer(usersCol),
            getCountFromServer(query(usersCol, where('isActive', '==', true)))
        ]);
        const totalCount = total.data().count;
        const activeCount = active.data().count;
        return {
            total: totalCount,
            active: activeCount,
            inactive: totalCount - activeCount
        };
    }

    private async getPostStats() {
        const postsCol = collection(this.firestore, 'posts');
        const [total, published] = await Promise.all([
            getCountFromServer(postsCol),
            getCountFromServer(query(postsCol, where('status', '==', 'published')))
        ]);
        const totalCount = total.data().count;
        const publishedCount = published.data().count;
        return {
            total: totalCount,
            published: publishedCount,
            draft: totalCount - publishedCount
        };
    }

    private async getPdfStats() {
        const pdfsCol = collection(this.firestore, 'pdfs');
        const [total, publicCount] = await Promise.all([
            getCountFromServer(pdfsCol),
            getCountFromServer(query(pdfsCol, where('isPublic', '==', true)))
        ]);
        const totalCount = total.data().count;
        const pubCount = publicCount.data().count;
        return {
            total: totalCount,
            public: pubCount,
            private: totalCount - pubCount
        };
    }

    private async getBannerStats() {
        const bannersCol = collection(this.firestore, 'banners');
        const [total, active] = await Promise.all([
            getCountFromServer(bannersCol),
            getCountFromServer(query(bannersCol, where('active', '==', true)))
        ]);
        const totalCount = total.data().count;
        const activeCount = active.data().count;
        return {
            total: totalCount,
            active: activeCount,
            inactive: totalCount - activeCount
        };
    }

    private async getDistributorStats() {
        const distributorsCol = collection(this.firestore, 'distributors');
        const [total, newCount, contacted, converted] = await Promise.all([
            getCountFromServer(distributorsCol),
            getCountFromServer(query(distributorsCol, where('status', '==', 'new'))),
            getCountFromServer(query(distributorsCol, where('status', '==', 'contacted'))),
            getCountFromServer(query(distributorsCol, where('status', '==', 'converted')))
        ]);
        return {
            total: total.data().count,
            new: newCount.data().count,
            contacted: contacted.data().count,
            converted: converted.data().count
        };
    }

    private async getNewsletterStats() {
        const newsletterCol = collection(this.firestore, 'newsletter');
        const snap = await getCountFromServer(newsletterCol);
        return {
            total: snap.data().count
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
