import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { AdminPageHeaderComponent } from '../shared/admin-page-header/admin-page-header.component';

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
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule, AdminPageHeaderComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  private firestore = inject(Firestore);

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
    categories: 0
  };

  isLoading = true;
  error = '';

  async ngOnInit() {

    await this.loadStats();
  }

  async loadStats() {
    try {


      // Get users count
      try {
        const usersSnap = await getDocs(collection(this.firestore, 'users'));
        this.stats.users = usersSnap.size;

      } catch (err: any) {
        console.error('❌ Error loading users:', err.message);
      }

      // Get blog posts count
      try {
        const postsSnap = await getDocs(collection(this.firestore, 'blog_posts'));
        this.stats.posts = postsSnap.size;

      } catch (err: any) {
        console.error('❌ Error loading blog posts:', err.message);
      }

      // Get PDFs count
      try {
        const pdfsSnap = await getDocs(collection(this.firestore, 'pdfs'));
        this.stats.pdfs = pdfsSnap.size;

      } catch (err: any) {
        console.error('❌ Error loading PDFs:', err.message);
      }

      // Get banners count
      try {
        const bannersSnap = await getDocs(collection(this.firestore, 'banners'));
        this.stats.banners = bannersSnap.size;

      } catch (err: any) {
        console.error('❌ Error loading banners:', err.message);
      }

      // Get distributors count
      try {
        const distributorsSnap = await getDocs(collection(this.firestore, 'distributors'));
        this.stats.distributors = distributorsSnap.size;

      } catch (err: any) {
        console.error('❌ Error loading distributors:', err.message);
      }

      // Get newsletter count
      try {
        const newsletterSnap = await getDocs(collection(this.firestore, 'newsletter'));
        this.stats.newsletter = newsletterSnap.size;

      } catch (err: any) {
        console.error('❌ Error loading newsletter:', err.message);
      }

      // Get products stats
      try {
        const productsSnap = await getDocs(collection(this.firestore, 'products'));
        this.stats.products = productsSnap.size;

        let activeCount = 0;
        let lowStockCount = 0;
        let outStockCount = 0;

        productsSnap.forEach(doc => {
          const product = doc.data();
          if (product['active']) activeCount++;
          if (product['inStock'] && product['stockQuantity'] <= 5 && product['stockQuantity'] > 0) lowStockCount++;
          if (!product['inStock'] || product['stockQuantity'] === 0) outStockCount++;
        });

        this.stats.productsActive = activeCount;
        this.stats.productsLowStock = lowStockCount;
        this.stats.productsOutStock = outStockCount;


      } catch (err: any) {
        console.error('❌ Error loading products:', err.message);
      }

      // Get brands count
      try {
        const brandsSnap = await getDocs(collection(this.firestore, 'brands'));
        this.stats.brands = brandsSnap.size;

      } catch (err: any) {
        console.error('❌ Error loading brands:', err.message);
      }

      // Get categories count
      try {
        const categoriesSnap = await getDocs(collection(this.firestore, 'categories'));
        this.stats.categories = categoriesSnap.size;

      } catch (err: any) {
        console.error('❌ Error loading categories:', err.message);
      }

      this.isLoading = false;
      // Stats loaded
    } catch (err: any) {
      console.error('❌ Error loading stats:', err);
      this.error = err.message;
      this.isLoading = false;
    }
  }
}
