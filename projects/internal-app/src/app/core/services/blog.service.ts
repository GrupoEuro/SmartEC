import { Injectable, inject } from '@angular/core';
import { Observable, from } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { BlogPost } from '../models/blog.model';
import {
    Firestore,
    collection,
    collectionData,
    doc,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    limit,
    setDoc,
    orderBy
} from '@angular/fire/firestore';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { AdminLogService } from './admin-log.service';

@Injectable({
    providedIn: 'root'
})
export class BlogService {
    private firestore: Firestore = inject(Firestore);
    private storage: Storage = inject(Storage);
    private logService = inject(AdminLogService);
    private collectionName = 'blog_posts';

    constructor() { }

    getPosts(): Observable<BlogPost[]> {
        const colRef = collection(this.firestore, this.collectionName);
        const q = query(colRef, orderBy('date', 'desc'));
        return from(getDocs(q)).pipe(
            map(snapshot => snapshot.docs.map(doc => {
                const data = doc.data();
                // Improved date conversion with fallback
                let postDate: Date;
                if (data['date']?.toDate) {
                    postDate = data['date'].toDate();
                } else if (data['date']) {
                    postDate = new Date(data['date']);
                } else {
                    postDate = new Date(); // Fallback to current date
                }

                return {
                    id: doc.id,
                    ...data,
                    date: postDate
                } as BlogPost;
            })),
            catchError(error => {
                console.error('Firestore error in getPosts:', error);
                throw error; // Re-throw to let component handle it
            })
        );
    }

    getPostBySlug(slug: string): Observable<BlogPost | undefined> {
        const colRef = collection(this.firestore, this.collectionName);
        const q = query(colRef, where('slug', '==', slug), limit(1));
        return from(getDocs(q)).pipe(
            map(snapshot => {
                if (snapshot.empty) return undefined;
                const doc = snapshot.docs[0];
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    date: data['date']?.toDate ? data['date'].toDate() : data['date']
                } as BlogPost;
            })
        );
    }

    getPostById(id: string): Observable<BlogPost | undefined> {
        const docRef = doc(this.firestore, this.collectionName, id);
        return from(getDoc(docRef)).pipe(
            map(snap => {
                if (!snap.exists()) return undefined;
                const data = snap.data();
                return {
                    id: snap.id,
                    ...data,
                    date: data['date']?.toDate ? data['date'].toDate() : data['date']
                } as BlogPost;
            })
        );
    }

    getRelatedPosts(currentId: string): Observable<BlogPost[]> {
        // Simple implementation: get recent posts excluding current
        // Ideally use backend logic or more complex query
        const colRef = collection(this.firestore, this.collectionName);
        const q = query(colRef, limit(3));
        return from(getDocs(q)).pipe(
            map(snapshot => {
                const posts = snapshot.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        ...data,
                        date: data['date']?.toDate ? data['date'].toDate() : data['date']
                    } as BlogPost;
                });
                return posts.filter(p => p.id !== currentId).slice(0, 2);
            })
        );
    }

    // Admin Methods

    async createPost(post: BlogPost, imageFile?: File): Promise<void> {
        // Upload image if present
        if (imageFile) {
            const path = `blog/${new Date().getTime()}_${imageFile.name}`;
            const storageRef = ref(this.storage, path);
            const result = await uploadBytes(storageRef, imageFile);
            post.coverImage = await getDownloadURL(result.ref);
        }

        const colRef = collection(this.firestore, this.collectionName);
        // Ensure date is a Timestamp or Date object (Firestore handles Date)
        const docRef = await addDoc(colRef, { ...post });
        this.logService.log('CREATE', 'BLOG', `Created post: ${post.title}`, docRef.id);
    }

    async updatePost(id: string, post: Partial<BlogPost>, imageFile?: File): Promise<void> {
        if (imageFile) {
            // Delete old image logic could go here if we tracked image path
            const path = `blog/${new Date().getTime()}_${imageFile.name}`;
            const storageRef = ref(this.storage, path);
            const result = await uploadBytes(storageRef, imageFile);
            post.coverImage = await getDownloadURL(result.ref);
        }

        const docRef = doc(this.firestore, this.collectionName, id);
        await updateDoc(docRef, { ...post });
        this.logService.log('UPDATE', 'BLOG', `Updated post: ${post.title || 'untitled'}`, id);
    }

    async deletePost(id: string): Promise<void> {
        const docRef = doc(this.firestore, this.collectionName, id);
        await deleteDoc(docRef);
        this.logService.log('DELETE', 'BLOG', 'Deleted post', id);
    }
}
