import { Component, inject, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Firestore, collection, query, orderBy, limit, getDocs, Timestamp } from '@angular/fire/firestore';
import { AdminLog } from '../../../../core/models/admin-log.model';
import { TranslateModule } from '@ngx-translate/core';
import { AdminPageHeaderComponent } from '../../shared/admin-page-header/admin-page-header.component';

@Component({
  selector: 'app-admin-log-list',
  standalone: true,
  imports: [CommonModule, DatePipe, TranslateModule, AdminPageHeaderComponent],
  templateUrl: './admin-log-list.component.html',
  styleUrl: './admin-log-list.component.css'
})
export class AdminLogListComponent implements OnInit {
  private firestore = inject(Firestore);
  allLogs: AdminLog[] = [];
  displayedLogs: AdminLog[] = [];
  loading = true;
  error = false;

  // Pagination
  currentPage = 1;
  pageSize = 10;
  totalPages = 0;

  async ngOnInit() {


    try {
      const colRef = collection(this.firestore, 'admin_logs');
      const q = query(colRef, orderBy('timestamp', 'desc'), limit(100));
      const querySnapshot = await getDocs(q);

      this.allLogs = querySnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          timestamp: data['timestamp'] instanceof Timestamp
            ? (data['timestamp'] as Timestamp).toDate()
            : data['timestamp']
        } as AdminLog;
      });

      this.totalPages = Math.ceil(this.allLogs.length / this.pageSize);
      this.updateDisplayedLogs();


      this.loading = false;
    } catch (err) {
      console.error('❌ Error loading logs:', err);
      this.error = true;
      this.loading = false;
    }
  }

  updateDisplayedLogs() {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    this.displayedLogs = this.allLogs.slice(startIndex, endIndex);
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.updateDisplayedLogs();
    }
  }

  nextPage() {
    this.goToPage(this.currentPage + 1);
  }

  previousPage() {
    this.goToPage(this.currentPage - 1);
  }

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }
}
