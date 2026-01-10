import { Injectable, inject, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Auth, GoogleAuthProvider, signInWithPopup, signOut, user, User } from '@angular/fire/auth';
import { Firestore, doc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, getDoc } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { Observable, of, switchMap, firstValueFrom } from 'rxjs';
import { AdminLogService } from './admin-log.service';
import { ToastService } from './toast.service';
import { UserProfile } from '../models/user.model';
import { DevConfigService } from './dev-config.service';
import { StateRegistryService } from './state-registry.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth: Auth = inject(Auth);
  private firestore: Firestore = inject(Firestore);
  private router: Router = inject(Router);
  private logService = inject(AdminLogService);
  private platformId = inject(PLATFORM_ID);
  private toast: ToastService = inject(ToastService);
  private devConfig = inject(DevConfigService);
  private stateRegistry = inject(StateRegistryService);

  // Raw Firebase User
  user$: Observable<User | null>;

  // Full User Profile from Firestore
  userProfile$: Observable<UserProfile | null>;

  // Inspector Signals
  readonly currentUser = signal<User | null>(null);
  readonly currentProfile = signal<UserProfile | null>(null);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.user$ = user(this.auth);

      // Sync logic: Use getDoc instead of docData to avoid type mismatch
      this.userProfile$ = this.user$.pipe(
        switchMap(firebaseUser => {
          this.currentUser.set(firebaseUser); // Update Inspector
          if (!firebaseUser) {
            this.currentProfile.set(null); // Update Inspector
            return of(null);
          }
          const userDocRef = doc(this.firestore, 'users', firebaseUser.uid);

          // Use getDoc (promise) instead of docData (observable) to avoid SDK conflicts
          return new Observable<UserProfile | null>(observer => {
            getDoc(userDocRef)
              .then(snapshot => {
                if (snapshot.exists()) {
                  const profile = snapshot.data() as UserProfile;
                  this.currentProfile.set(profile); // Update Inspector
                  observer.next(profile);
                } else {
                  console.log('Auth Debug: No profile document found');
                  this.currentProfile.set(null); // Update Inspector
                  observer.next(null);
                }
                observer.complete();
              })
              .catch(err => {
                console.error('Auth Debug: Firestore Error:', err);
                observer.next(null);
                observer.complete();
              });
          });
        })
      );

    } else {
      this.user$ = of(null);
      this.userProfile$ = of(null);
    }

    // Register with Inspector
    this.stateRegistry.register({
      name: 'AuthService',
      get: () => ({
        user: this.currentUser(),
        profile: this.currentProfile(),
        isAuthenticated: !!this.currentUser(),
        role: this.currentProfile()?.role || 'guest'
      })
    });
  }

  async loginWithGoogle() {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      const provider = new GoogleAuthProvider();
      const credential = await signInWithPopup(this.auth, provider);
      const firebaseUser = credential.user;

      // Sync/Check Profile
      const profile = await this.syncUserProfile(firebaseUser);

      if (!profile) {
        // No profile found => Not authorized
        this.toast.error('Access Denied. You are not authorized to access this panel.');
        await signOut(this.auth);
        return;
      }

      if (!profile.isActive) {
        this.toast.error('Your account has been deactivated.');
        await signOut(this.auth);
        return;
      }

      console.log('Logging login action...');
      await this.logService.log('LOGIN', 'AUTH', `User logged in: ${profile.email} (${profile.role})`);
      console.log('Login logged successfully');

      const displayName = profile.displayName || profile.email.split('@')[0];
      this.toast.success(`Welcome back, ${displayName}!`);
      this.router.navigate(['/admin/dashboard']);

    } catch (error: any) {
      console.error('Login error:', error);
      if (error.code === 'auth/operation-not-allowed') {
        this.toast.error('Google Login is not enabled. Please contact support.');
      } else if (error.code === 'auth/popup-closed-by-user') {
        this.toast.info('Login canceled.');
      } else {
        this.toast.error('Login failed: ' + error.message);
      }
    }
  }

  // Links an invited email to this UID or updates existing user
  private async syncUserProfile(firebaseUser: User): Promise<UserProfile | null> {
    const userRef = doc(this.firestore, 'users', firebaseUser.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const profile = userSnap.data() as UserProfile;
      // Update last login
      await updateDoc(userRef, { lastLogin: new Date() });
      return profile;
    }

    // If no doc at UID, look for an "Invite" by email
    const emailToQuery = firebaseUser.email?.toLowerCase();
    const q = query(collection(this.firestore, 'users'), where('email', '==', emailToQuery));
    const qSnap = await getDocs(q);

    if (!qSnap.empty) {
      // Found invitation! Migrate to UID-based doc
      const inviteDoc = qSnap.docs[0];
      const inviteData = inviteDoc.data() as UserProfile;

      const newProfile: UserProfile = {
        ...inviteData,
        uid: firebaseUser.uid,
        displayName: firebaseUser.displayName || inviteData.displayName || '',
        photoURL: firebaseUser.photoURL || '',
        lastLogin: new Date()
      };

      // 1. Create new doc at UID location
      await setDoc(userRef, newProfile);
      // 2. Delete the temporary invite doc
      await deleteDoc(inviteDoc.ref);

      return newProfile;
    }

    // No profile and no invite
    return null;
  }

  async logout() {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      // Log before signing out
      await this.logService.log('LOGOUT', 'AUTH', 'User logged out');

      await signOut(this.auth);
      this.toast.success('Logged out successfully.');
      this.router.navigate(['/admin/login']);
    } catch (error: any) {
      console.error('Logout error:', error);
      this.toast.error('Logout failed: ' + error.message);
    }
  }

  async getCurrentUser(): Promise<UserProfile | null> {
    if (!isPlatformBrowser(this.platformId)) return null;

    // Check for GOD MODE override (Role Impersonation)
    const impersonatedRole = this.devConfig.getImpersonatedRole();

    return new Promise((resolve) => {
      this.userProfile$.subscribe({
        next: (profile) => {
          if (profile && impersonatedRole) {
            // Return a modified clone of the profile
            resolve({ ...profile, role: impersonatedRole as any });
          } else {
            resolve(profile);
          }
        },
        error: () => resolve(null)
      });
    });
  }

  isAdmin(user: User): boolean {
    return !!user; // Kept for backward compat, but RoleGuard will handle real checks
  }
}
