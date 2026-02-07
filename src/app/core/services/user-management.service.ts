import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, updateDoc, addDoc, deleteDoc, getDocs, query, where } from '@angular/fire/firestore';
import { Observable, from, BehaviorSubject } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { UserProfile, UserRole } from '../models/user.model';

@Injectable({
    providedIn: 'root'
})
export class UserManagementService {
    private firestore = inject(Firestore);
    private usersCollection = collection(this.firestore, 'users');
    private customersCollection = collection(this.firestore, 'customers');

    private customersCache$ = new BehaviorSubject<UserProfile[] | null>(null);

    getCustomers(forceRefresh = false): Observable<UserProfile[]> {
        // Return cached data if available and not forcing refresh
        if (this.customersCache$.value && !forceRefresh) {
            return this.customersCache$.asObservable().pipe(
                map(users => users || [])
            );
        }

        // Fetch directly from 'customers' collection
        return from(getDocs(this.customersCollection)).pipe(
            map(snapshot => {
                const customers: UserProfile[] = [];
                snapshot.forEach(doc => {
                    customers.push(this.mapUser(doc.id, doc.data()));
                });
                this.customersCache$.next(customers); // Update cache
                return customers;
            }),
            shareReplay(1)
        );
    }

    searchCustomers(term: string): Observable<UserProfile[]> {
        const searchTerm = term.toLowerCase();
        // Client-side filtering for now as Firestore doesn't support substring search easily
        // and 'displayName' case sensitivity varies.
        // For MVP with < 1000 users this is fine.
        return from(getDocs(this.customersCollection)).pipe(
            map(snapshot => {
                const customers: UserProfile[] = [];
                snapshot.forEach(doc => {
                    const data = doc.data();
                    const name = (data['displayName'] || '').toLowerCase();
                    const email = (data['email'] || '').toLowerCase();

                    if (name.includes(searchTerm) || email.includes(searchTerm)) {
                        customers.push(this.mapUser(doc.id, data));
                    }
                });
                return customers.slice(0, 10); // Limit results
            })
        );
    }

    getCustomerById(uid: string): Observable<UserProfile | undefined> {
        const docRef = doc(this.firestore, 'customers', uid);
        return from(getDocs(query(this.customersCollection, where('uid', '==', uid)))).pipe( // Optimally getDoc, but sticking to pattern
            map(snapshot => {
                if (snapshot.empty) return undefined;
                return this.mapUser(snapshot.docs[0].id, snapshot.docs[0].data());
            })
        );
        // Better implementation using getDoc for ID check
        /*
        return from(getDoc(docRef)).pipe(
           map(snap => snap.exists() ? this.mapUser(snap.id, snap.data()) : undefined)
        );
        */
    }

    // Helper for direct ID fetch if needed
    fetchCustomer(uid: string): Observable<UserProfile | undefined> {
        const ref = doc(this.firestore, 'customers', uid);
        // usage of getDoc needs import
        return from(getDocs(this.customersCollection)).pipe(
            map(snap => {
                const found = snap.docs.find(d => d.id === uid);
                return found ? this.mapUser(found.id, found.data()) : undefined;
            })
        );
    }

    // Alias for consistency
    getUserById(uid: string): Observable<UserProfile | undefined> {
        return this.getCustomerById(uid);
    }


    getStaff(): Observable<UserProfile[]> {
        return from(getDocs(this.usersCollection)).pipe(
            map(snapshot => {
                const staff: UserProfile[] = [];
                snapshot.forEach(doc => {
                    const data = doc.data();
                    const role = data['role'];
                    if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'EDITOR') {
                        staff.push(this.mapUser(doc.id, data));
                    }
                });
                return staff;
            })
        );
    }

    private mapUser(uid: string, data: any): UserProfile {
        const createdAt = data['createdAt']?.toDate ? data['createdAt'].toDate() : (data['createdAt'] ? new Date(data['createdAt']) : undefined);
        const lastLogin = data['lastLogin']?.toDate ? data['lastLogin'].toDate() : (data['lastLogin'] ? new Date(data['lastLogin']) : undefined);

        return {
            uid,
            email: data['email'] || '',
            displayName: data['displayName'] || '',
            photoURL: data['photoURL'] || '',
            role: data['role'] || 'CUSTOMER',
            isActive: data['isActive'] !== undefined ? data['isActive'] : true,
            createdAt: createdAt,
            lastLogin: lastLogin,
            phone: data['phone'],
            stats: data['stats'],
            shippingAddress: data['shippingAddress']
        };
    }

    // Keep original getUsers for admin/staff management
    getUsers(): Observable<UserProfile[]> {
        return from(getDocs(this.usersCollection)).pipe(
            map(snapshot => {
                const users: UserProfile[] = [];
                snapshot.forEach(doc => {
                    users.push(this.mapUser(doc.id, doc.data()));
                });
                return users;
            })
        );
    }

    /**
     * Get users by specific roles (for notifications, approvals, etc.)
     */
    async getUsersByRole(roles: UserRole[]): Promise<UserProfile[]> {
        const snapshot = await getDocs(this.usersCollection);
        const users: UserProfile[] = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            const userRole = data['role'] as UserRole;
            if (roles.includes(userRole)) {
                users.push(this.mapUser(doc.id, data));
            }
        });

        return users;
    }


    inviteUser(email: string, role: UserRole) {
        // Determine ID? If we use auto-id, AuthService sync logic works (it queries by email).
        const newUser: Partial<UserProfile> = {
            email: email.toLowerCase(),
            role: role,
            isActive: true,
            createdAt: new Date(),
            // uid will be assigned by Firestore or on claim
        };
        return from(addDoc(this.usersCollection, newUser));
    }

    updateUserRole(uid: string, role: UserRole) {
        const userRef = doc(this.firestore, 'users', uid);
        return from(updateDoc(userRef, { role }));
    }

    toggleUserStatus(uid: string, isActive: boolean) {
        const userRef = doc(this.firestore, 'users', uid);
        return from(updateDoc(userRef, { isActive }));
    }

    updateDisplayName(uid: string, displayName: string) {
        const userRef = doc(this.firestore, 'users', uid);
        return from(updateDoc(userRef, { displayName }));
    }

    deleteUser(uid: string) {
        // Be careful with delete, but for invites it's useful
        const userRef = doc(this.firestore, 'users', uid);
        return from(deleteDoc(userRef));
    }
}
