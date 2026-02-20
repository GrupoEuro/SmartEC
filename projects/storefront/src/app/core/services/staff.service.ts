
import { Injectable, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, query, where, Timestamp } from '@angular/fire/firestore';
import { UserManagementService } from './user-management.service';
import { StaffProfile, StaffMember } from '../models/staff.model';
import { UserProfile } from '../models/user.model';

@Injectable({
    providedIn: 'root'
})
export class StaffService {
    private firestore = inject(Firestore);
    private userService = inject(UserManagementService);

    private collectionName = 'staff_profiles';

    /**
     * Fetches all users with staff roles and merges their operational profile
     */
    async getAllStaff(): Promise<StaffMember[]> {
        // 1. Get Base Users
        // Ideally we should query users -> filtered by role
        // BUT we also want the profile.
        // Parallel fetch?

        const staffRoles = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'OPERATIONS', 'EDITOR', 'SALES'];
        const users = await this.userService.getUsersByRole(staffRoles as any);

        // 2. Get Profiles
        const profilesSnap = await getDocs(collection(this.firestore, this.collectionName));
        const profilesMap = new Map<string, StaffProfile>();
        profilesSnap.forEach(doc => {
            profilesMap.set(doc.id, doc.data() as StaffProfile);
        });

        // 3. Merge
        return users.map(user => ({
            ...user,
            profile: profilesMap.get(user.uid)
        }));
    }

    async getStaffMember(uid: string): Promise<StaffMember | null> {
        const user = await this.userService.getUserById(uid).toPromise();
        // Note: Observable toPromise is deprecated but often available. OR usage of firstValueFrom.
        // Given snippet in userService uses Observable.
        // I'll assume standard Observable handling.

        if (!user) return null;

        const profileSnap = await getDoc(doc(this.firestore, this.collectionName, uid));
        const profile = profileSnap.exists() ? (profileSnap.data() as StaffProfile) : undefined;

        return { ...user, profile };
    }

    async updateStaffProfile(uid: string, data: Partial<StaffProfile>) {
        const ref = doc(this.firestore, this.collectionName, uid);
        const snap = await getDoc(ref);

        const payload = {
            ...data,
            updated_at: Timestamp.now()
        };

        if (snap.exists()) {
            return updateDoc(ref, payload);
        } else {
            // Create if missing
            return setDoc(ref, {
                uid,
                created_at: Timestamp.now(),
                status: 'OFFLINE', // Default
                ...payload
            });
        }
    }
}
