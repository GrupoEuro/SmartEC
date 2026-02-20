import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Firestore, collection, getDocs, orderBy, limit, query, where, Timestamp } from '@angular/fire/firestore';
import { Order } from '../../../core/models/order.model';
import { UserProfile } from '../../../core/models/user.model';
import { BlogPost } from '../../../core/models/blog.model';
import { Banner } from '../services/banner.service';
import { Product } from '../../../core/models/product.model';

interface ActivityItem {
  text: string;
  time: Date;
  timeString: string;
  link: string[];
  type: 'order' | 'user' | 'blog' | 'banner' | 'stock' | 'system';
}

interface SimpleStats {
  users: number;
  posts: number;
  pdfs: number;
  banners: number;
  distributors: number;
  newsletter: number;
  products: number;
  productsActive: number;
  productsLowStock: number;
  productsOutStock: number;
  brands: number;
  categories: number;
  orders: number;
  pendingOrders: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  private firestore = inject(Firestore);

  now = new Date();

  stats: SimpleStats = {
    users: 0,
    posts: 0,
    pdfs: 0,
    banners: 0,
    distributors: 0,
    newsletter: 0,
    products: 0,
    productsActive: 0,
    productsLowStock: 0,
    productsOutStock: 0,
    brands: 0,
    categories: 0,
    orders: 0,
    pendingOrders: 0
  };

  activities: ActivityItem[] = [];

  isLoading = true;
  error = '';

  async ngOnInit() {
    await Promise.all([
      this.loadStats(),
      this.loadActivities()
    ]);
  }

  async loadActivities() {
    try {
      const promises = [
        this.fetchRecentOrders(),
        this.fetchRecentUsers(),
        this.fetchRecentBlogPosts(),
        this.fetchRecentBanners(), // Will only show newly created/updated ones from now on
        this.fetchStockAlerts()
      ];

      const results = await Promise.all(promises);
      const allActivities = results.flat();

      // Sort by time desc
      this.activities = allActivities
        .sort((a, b) => b.time.getTime() - a.time.getTime())
        .slice(0, 10);

    } catch (error) {
      console.error('Error loading activities:', error);
    }
  }

  private async fetchRecentOrders(): Promise<ActivityItem[]> {
    try {
      const q = query(collection(this.firestore, 'orders'), orderBy('createdAt', 'desc'), limit(5));
      const snap = await getDocs(q);
      return snap.docs.map(doc => {
        const data = doc.data() as Order;
        const date = this.toDate(data.createdAt);
        return {
          text: `New Order #${data.orderNumber} - ${data.customer.name}`,
          time: date,
          timeString: this.getTimeAgo(date),
          link: ['/admin/orders', doc.id],
          type: 'order'
        };
      });
    } catch (e) { console.error('Error fetching orders', e); return []; }
  }

  private async fetchRecentUsers(): Promise<ActivityItem[]> {
    try {
      const q = query(collection(this.firestore, 'users'), orderBy('createdAt', 'desc'), limit(5));
      const snap = await getDocs(q);
      return snap.docs.map(doc => {
        const data = doc.data() as UserProfile;
        const date = this.toDate(data.createdAt);
        return {
          text: `New User Registered: ${data.displayName || data.email}`,
          time: date,
          timeString: this.getTimeAgo(date),
          link: ['/admin/users', data.uid],
          type: 'user'
        };
      });
    } catch (e) { console.error('Error fetching users', e); return []; }
  }

  private async fetchRecentBlogPosts(): Promise<ActivityItem[]> {
    try {
      const q = query(collection(this.firestore, 'blog_posts'), orderBy('date', 'desc'), limit(5));
      const snap = await getDocs(q);
      return snap.docs.map(doc => {
        const data = doc.data() as BlogPost;
        const date = this.toDate(data.date);
        return {
          text: `New Post: "${data.title}"`,
          time: date,
          timeString: this.getTimeAgo(date),
          link: ['/admin/blog', doc.id],
          type: 'blog'
        };
      });
    } catch (e) { console.error('Error fetching blog', e); return []; }
  }

  private async fetchRecentBanners(): Promise<ActivityItem[]> {
    try {
      // Note: older banners might not have createdAt, so we might need a fallback or index could be tricky
      // For now, try orderBy createdAt if possible, or just get recent and sort locally if small set
      // Assuming 'banners' collection is small enough to just process top 10
      const q = query(collection(this.firestore, 'banners'), limit(20));
      const snap = await getDocs(q);
      return snap.docs
        .map(doc => {
          const data = doc.data() as Banner;
          // Fallback for missing timestamp
          return {
            data,
            id: doc.id
          };
        })
        .filter(item => item.data.updatedAt || item.data.createdAt) // Only show if we have a date
        .map(item => {
          const date = this.toDate(item.data.updatedAt || item.data.createdAt);
          return {
            text: `Banner Updated: "${item.data.title}"`,
            time: date,
            timeString: this.getTimeAgo(date),
            link: ['/admin/banners'],
            type: 'banner'
          } as ActivityItem;
        });
    } catch (e) { console.error('Error fetching banners', e); return []; }
  }

  private async fetchStockAlerts(): Promise<ActivityItem[]> {
    try {
      // Simple query for low stock
      const q = query(
        collection(this.firestore, 'products'),
        where('active', '==', true),
        where('stockQuantity', '<=', 5),
        limit(10)
      );
      const snap = await getDocs(q);

      // Stock alerts don't exactly have a "happened at" time, 
      // but we can treat them as "current alerts" (time = now) 
      // OR use 'updatedAt' if we want to show when it dropped.
      // Let's use updatedAt to be accurate to when the change happened.
      return snap.docs.map(doc => {
        const data = doc.data() as Product;
        const date = this.toDate(data.updatedAt);
        return {
          text: `Low Stock Alert: ${data.name.en} (${data.stockQuantity} left)`,
          time: date,
          timeString: this.getTimeAgo(date),
          link: ['/admin/products', doc.id],
          type: 'stock'
        };
      });
    } catch (e) { console.error('Error fetching stock alerts', e); return []; }
  }

  private toDate(val: any): Date {
    if (!val) return new Date();
    if (val instanceof Timestamp) return val.toDate();
    if (typeof val.toDate === 'function') return val.toDate();
    if (val instanceof Date) return val;
    return new Date(val); // fallback for strings/numbers
  }

  private getTimeAgo(date: Date): string {
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";

    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";

    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";

    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";

    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes ago";

    return Math.floor(seconds) + " seconds ago";
  }

  async loadStats() {
    try {
      this.isLoading = true;

      // Create promises for all counts
      const pUsers = getDocs(collection(this.firestore, 'users'));
      const pOrders = getDocs(collection(this.firestore, 'orders'));
      const pPending = getDocs(query(collection(this.firestore, 'orders'), where('status', '==', 'pending')));
      const pPosts = getDocs(collection(this.firestore, 'blog_posts'));
      const pPdfs = getDocs(collection(this.firestore, 'pdfs'));
      const pBanners = getDocs(collection(this.firestore, 'banners'));
      const pDistributors = getDocs(collection(this.firestore, 'distributors'));
      const pNewsletter = getDocs(collection(this.firestore, 'newsletter'));
      const pBrands = getDocs(collection(this.firestore, 'brands'));
      const pCategories = getDocs(collection(this.firestore, 'categories'));
      const pProducts = getDocs(collection(this.firestore, 'products'));

      // Execute in parallel
      const [
        usersSnap, ordersSnap, pendingSnap, postsSnap,
        pdfsSnap, bannersSnap, distributorsSnap, newsletterSnap,
        brandsSnap, categoriesSnap, productsSnap
      ] = await Promise.all([
        pUsers, pOrders, pPending, pPosts,
        pPdfs, pBanners, pDistributors, pNewsletter,
        pBrands, pCategories, pProducts
      ]);

      // Assign counts
      this.stats.users = usersSnap.size;
      this.stats.orders = ordersSnap.size;
      this.stats.pendingOrders = pendingSnap.size;
      this.stats.posts = postsSnap.size;
      this.stats.pdfs = pdfsSnap.size;
      this.stats.banners = bannersSnap.size;
      this.stats.distributors = distributorsSnap.size;
      this.stats.newsletter = newsletterSnap.size;
      this.stats.brands = brandsSnap.size;
      this.stats.categories = categoriesSnap.size;
      this.stats.products = productsSnap.size;

      // Calculate Product status details
      let activeCount = 0;
      let lowStockCount = 0;
      let outStockCount = 0;

      productsSnap.forEach(doc => {
        const product = doc.data();
        if (product['active']) activeCount++;
        // Low stock logic: In stock AND <= 5
        if (product['inStock'] && product['stockQuantity'] <= 5 && product['stockQuantity'] > 0) lowStockCount++;
        // Out stock logic: Not in stock OR qty 0
        if (!product['inStock'] || product['stockQuantity'] === 0) outStockCount++;
      });

      this.stats.productsActive = activeCount;
      this.stats.productsLowStock = lowStockCount;
      this.stats.productsOutStock = outStockCount;

    } catch (err: any) {
      console.error('❌ Error loading dashboard stats:', err);
      this.error = 'Failed to load some dashboard data.';
    } finally {
      this.isLoading = false;
    }
  }
}
