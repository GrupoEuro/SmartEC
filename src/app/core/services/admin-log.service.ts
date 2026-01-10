import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, query, orderBy, limit, getDocs, where } from '@angular/fire/firestore';
import { FirestoreTrackerService } from '../../pages/dev-tools/services/firestore-tracker.service';
import { Auth } from '@angular/fire/auth';
import { AdminLog } from '../models/admin-log.model';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AdminLogService {
  private firestore: Firestore = inject(Firestore);
  private auth = inject(Auth);
  private http = inject(HttpClient);
  private collectionName = 'admin_logs';

  constructor() {
  }

  async log(action: AdminLog['action'], module: AdminLog['module'], details: string, targetId?: string) {
    const tracker = inject(FirestoreTrackerService); // Lazy inject to avoid circular deps if any
    console.log('AdminLogService.log() called:', { action, module, details });

    const user = this.auth.currentUser;
    const email = user?.email || 'unknown';
    const uid = user?.uid || 'unknown';

    // Fetch IP Address
    const ipAddress = await this.getClientIp();

    const logEntry: any = {
      action,
      module,
      details,
      timestamp: new Date(),
      userEmail: email,
      userId: uid,
      ipAddress
    };

    if (targetId !== undefined) {
      logEntry.targetId = targetId;
    }

    try {
      const docRef = await addDoc(collection(this.firestore, this.collectionName), logEntry);
      tracker.trackWrite(1); // TRACK WRITE
      console.log('✅ Log entry written successfully with ID:', docRef.id);
    } catch (error) {
      console.error('❌ Failed to write admin log:', error);
    }
  }

  /**
   * Fetch recent logs with optional filtering
   */
  async getLogs(limitCount = 50, moduleFilter?: string): Promise<any[]> {
    try {
      const logsRef = collection(this.firestore, this.collectionName);
      let q = query(logsRef, orderBy('timestamp', 'desc'), limit(limitCount));

      // Note: Composite index might be needed for where + orderBy
      if (moduleFilter && moduleFilter !== 'ALL') {
        q = query(logsRef, where('module', '==', moduleFilter), orderBy('timestamp', 'desc'), limit(limitCount));
      }

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: (doc.data() as any).timestamp?.toDate()
      }));
    } catch (e) {
      console.error('Error fetching logs:', e);
      return [];
    }
  }

  private async getClientIp(): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ ip: string }>('https://api.ipify.org?format=json').pipe(
          catchError(() => of({ ip: 'unknown' }))
        )
      );
      return response.ip;
    } catch (e) {
      return 'unknown';
    }
  }
}
