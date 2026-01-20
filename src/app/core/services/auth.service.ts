import { Injectable, inject, PLATFORM_ID, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { Auth, GoogleAuthProvider, signInWithPopup, signOut, user, User, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from '@angular/fire/auth';
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
  private destroyRef = inject(DestroyRef);

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

    // START SUBSCRIPTION to keep signals updated!
    if (isPlatformBrowser(this.platformId)) {
      this.userProfile$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    }
  }

  async loginWithGoogle() {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      const provider = new GoogleAuthProvider();
      const credential = await signInWithPopup(this.auth, provider);
      await this.handleLoginSuccess(credential.user);
    } catch (error: any) {
      this.handleAuthError(error, 'Google Login');
    }
  }

  async loginWithEmail(email: string, pass: string) {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const credential = await signInWithEmailAndPassword(this.auth, email, pass);
      const user = credential.user;

      // STRICT CHECK: Email login only for CUSTOMER role
      const profile = await this.syncUserProfile(user);
      if (profile && profile.role !== 'CUSTOMER') {
        this.toast.error('Admin/Staff must use Google Login.');
        await signOut(this.auth);
        return;
      }

      await this.handleLoginSuccess(user);
    } catch (error: any) {
      this.handleAuthError(error, 'Login');
    }
  }

  async registerWithEmail(email: string, pass: string, displayName: string) {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const credential = await createUserWithEmailAndPassword(this.auth, email, pass);
      const user = credential.user;

      // Update Auth Profile
      await updateProfile(user, { displayName });

      // Create Firestore Profile (Customer by default)
      const newProfile: UserProfile = {
        uid: user.uid,
        email: user.email || email,
        displayName: displayName,
        photoURL: '',
        role: 'CUSTOMER',
        isActive: true,
        createdAt: new Date(),
        lastLogin: new Date(),
        stats: { totalOrders: 0, totalSpend: 0, averageOrderValue: 0 }
      };

      const userRef = doc(this.firestore, 'users', user.uid);
      await setDoc(userRef, newProfile);

      // Also create in 'customers' collection if we are separating them
      const custRef = doc(this.firestore, 'customers', user.uid);
      await setDoc(custRef, newProfile);

      this.toast.success(`Welcome, ${displayName}! Account created.`);
      await this.logService.log('REGISTER', 'AUTH', `New user registered: ${email}`);
      this.router.navigate(['/account']);

    } catch (error: any) {
      this.handleAuthError(error, 'Registration');
    }
  }

  private async handleLoginSuccess(firebaseUser: User) {
    let profile = await this.syncUserProfile(firebaseUser);

    // ORPHAN RECOVERY: If Auth exists but Firestore profile is missing, create it.
    if (!profile) {
      console.warn('AuthService: Orphaned account detected. Creating fallback profile.', firebaseUser.email);
      const newProfile: UserProfile = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
        photoURL: firebaseUser.photoURL || '',
        role: 'CUSTOMER', // Default to Customer for safety
        isActive: true,
        createdAt: new Date(),
        lastLogin: new Date(),
        stats: { totalOrders: 0, totalSpend: 0, averageOrderValue: 0 }
      };

      try {
        await setDoc(doc(this.firestore, 'users', firebaseUser.uid), newProfile);
        // Also ensure it's in customers if we are mirroring
        await setDoc(doc(this.firestore, 'customers', firebaseUser.uid), newProfile);

        profile = newProfile;
        this.logService.log('REGISTER', 'AUTH', `Recovered orphan account: ${newProfile.email}`);
      } catch (err) {
        console.error('AuthService: Failed to recover orphan account', err);
        this.toast.error('Account error. Please contact support.');
        await signOut(this.auth);
        return;
      }
    }

    if (!profile.isActive) {
      this.toast.error('Your account has been deactivated.');
      await signOut(this.auth);
      return;
    }

    await this.logService.log('LOGIN', 'AUTH', `User logged in: ${profile.email} (${profile.role})`);

    const name = profile.displayName || profile.email.split('@')[0];
    this.toast.success(`Welcome back, ${name}!`);

    // Redirect based on role
    if (profile.role === 'CUSTOMER') {
      this.router.navigate(['/account']);
    } else {
      this.router.navigate(['/portal']);
    }
  }

  private handleAuthError(error: any, context: string) {
    console.error(`${context} error:`, error);
    let msg = error.message;
    if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
      msg = 'Invalid email or password.';
    } else if (error.code === 'auth/email-already-in-use') {
      msg = 'Email is already in use.';
    }
    this.toast.error(`${context} failed: ${msg}`);
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

  // Helper method to check login status
  isLoggedIn(): boolean {
    return !!this.currentUser();
  }

  isAdmin(user: User): boolean {
    return !!user; // Kept for backward compat, but RoleGuard will handle real checks
  }
}
