import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, doc, deleteDoc, setDoc, addDoc, updateDoc } from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { Observable } from 'rxjs';
import { AdminLogService } from '../../../core/services/admin-log.service';

export interface Banner {
  id?: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  imagePath: string; // Store path to delete later
  link?: string;
  order: number;
  active: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class BannerService {
  private firestore: Firestore = inject(Firestore);
  private storage = inject(Storage);
  private logService = inject(AdminLogService);
  private collectionName = 'banners';

  constructor() { }

  getBanners(): Observable<Banner[]> {
    const colRef = collection(this.firestore, this.collectionName);
    return collectionData(colRef, { idField: 'id' }) as Observable<Banner[]>;
  }

  async createBanner(banner: Banner, file: File): Promise<void> {
    const path = `banners/${new Date().getTime()}_${file.name}`;
    const storageRef = ref(this.storage, path);
    const result = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(result.ref);

    banner.imageUrl = url;
    banner.imagePath = path;

    const colRef = collection(this.firestore, this.collectionName);
    const docRef = await addDoc(colRef, banner);
    this.logService.log('CREATE', 'BANNER', `Created banner: ${banner.title}`, docRef.id);
  }

  async updateBanner(id: string, banner: Banner, file?: File): Promise<void> {
    if (file) {
      // Delete old image if exists
      if (banner.imagePath) {
        try {
          const oldRef = ref(this.storage, banner.imagePath);
          await deleteObject(oldRef);
        } catch (e) {
          console.error('Error deleting old image', e);
        }
      }

      // Upload new
      const path = `banners/${new Date().getTime()}_${file.name}`;
      const storageRef = ref(this.storage, path);
      const result = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(result.ref);

      banner.imageUrl = url;
      banner.imagePath = path;
    }

    const docRef = doc(this.firestore, this.collectionName, id);
    await updateDoc(docRef, { ...banner });
    this.logService.log('UPDATE', 'BANNER', `Updated banner: ${banner.title}`, id);
  }

  async deleteBanner(banner: Banner): Promise<void> {
    if (banner.id) {
      // Delete image
      if (banner.imagePath) {
        try {
          const storageRef = ref(this.storage, banner.imagePath);
          await deleteObject(storageRef);
        } catch (e) {
          console.error('Error deleting image', e);
        }
      }
      const docRef = doc(this.firestore, this.collectionName, banner.id);
      await deleteDoc(docRef);
      this.logService.log('DELETE', 'BANNER', `Deleted banner: ${banner.title}`, banner.id);
    }
  }
}
