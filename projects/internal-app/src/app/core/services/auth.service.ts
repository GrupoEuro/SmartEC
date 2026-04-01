import { Injectable, inject, PLATFORM_ID, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { Auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, user, User, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from '@angular/fire/auth';
import { Firestore, doc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, getDoc } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { Observable, of, switchMap, firstValueFrom, BehaviorSubject, filter, take } from 'rxjs';
import { AdminLogService } from './admin-log.service';
import { ToastService } from './toast.service';
import { UserProfile } from '../models/user.model';
import { DevConfigService } from './dev-config.service';
import { StateRegistryService } from './state-registry.service';
import { environment } from '../../../environments/environment';

// Roles permitted to use the Internal App. Customers are explicitly excluded.
const INTERNAL_STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF'];

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

  // Emits true once Firebase Auth has resolved its initial state (incl. redirect result)
  private _authReady = new BehaviorSubject<boolean>(false);
  readonly authReady$ = this._authReady.asObservable().pipe(filter(v => v), take(1));

  // Inspector Signals
  readonly currentUser = signal<User | null>(null);
  readonly currentProfile = signal<UserProfile | null>(null);

  // Prevents the background userProfile$ subscription from overwriting the signal
  // after handleLoginSuccess has already set it (guards the redirect flow race condition)
  private _loginHandled = false;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.user$ = user(this.auth);

      // Sync logic: Use getDoc instead of docData to avoid type mismatch
      this.userProfile$ = this.user$.pipe(
        switchMap(firebaseUser => {
          this.currentUser.set(firebaseUser); // Update Inspector
          if (!firebaseUser) {
            // Only null-out profile signal if handleLoginSuccess hasn't claimed it
            if (!this._loginHandled) {
              this.currentProfile.set(null);
            } else {
            }
            return of(null);
          }
          const userDocRef = doc(this.firestore, 'users', firebaseUser.uid);

          // Use getDoc (promise) instead of docData (observable) to avoid SDK conflicts
          return new Observable<UserProfile | null>(observer => {
            getDoc(userDocRef)
              .then(snapshot => {
                if (snapshot.exists()) {
                  const profile = snapshot.data() as UserProfile;
                  // Always update when we get a real profile (keep signals fresh for refresh)
                  this.currentProfile.set(profile); // Update Inspector
                  observer.next(profile);
                } else {
                  if (!environment.production) console.log('[Auth] No profile document found for uid:', firebaseUser.uid);
                  if (!this._loginHandled) {
                    this.currentProfile.set(null); // Update Inspector
                  }
                  observer.next(null);
                }
                observer.complete();
              })
              .catch(err => {
                if (!environment.production) console.error('[Auth] Firestore profile fetch error:', err);
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

    // Background subscription keeps signals updated for persistent sessions
    if (isPlatformBrowser(this.platformId)) {
      this.userProfile$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    }
    // Wait for Firebase to resolve its initial auth state before signaling guards.
    // IMPORTANT: getRedirectResult() must be started IMMEDIATELY at init time, in parallel
    // with onAuthStateChanged. If called inside the onAuthStateChanged callback, it may
    // return null because the SDK hasn't finished reading the redirect result from storage yet.
    if (isPlatformBrowser(this.platformId)) {
      import('@angular/fire/auth').then(({ onAuthStateChanged, getRedirectResult }) => {

        // Start getRedirectResult immediately — reads the pending OAuth result from storage.
        const redirectResultPromise = getRedirectResult(this.auth)
          .then(async (result) => {
            if (result?.user) {
              await this.handleLoginSuccess(result.user);
              return true; // handleLoginSuccess calls _authReady.next(true)
            }
            return false;
          })
          .catch((err: any) => {
            if (err?.code !== 'auth/no-auth-event') {
            } else {
            }
            return false;
          });

        let firstEmission = true;
        onAuthStateChanged(this.auth, async (firebaseUser) => {
          if (firstEmission) {
            firstEmission = false;

            // Wait for getRedirectResult to settle BEFORE signaling authReady.
            // If a redirect login just happened, handleLoginSuccess() already signals ready.
            const redirectHandled = await redirectResultPromise;
            if (!redirectHandled) {
              this._authReady.next(true);
            }
          }
        });
      });
    }
  }  // end constructor

  async loginWithGoogle() {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(this.auth, provider);
      await this.handleLoginSuccess(result.user);
    } catch (error: any) {
      if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') {
        return;
      }
      this.handleAuthError(error, 'Google Login');
    }
  }


  async loginWithEmail(email: string, pass: string) {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const credential = await signInWithEmailAndPassword(this.auth, email, pass);
      const user = credential.user;

      await this.syncUserProfile(user);

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
    // Block the background userProfile$ subscription from nulling out the profile signal
    // during this login flow (it fires with null temporarily during redirect resolution)
    this._loginHandled = true;

    let profile = await this.syncUserProfile(firebaseUser);

    // ORPHAN RECOVERY: If Auth exists but Firestore profile is missing, create it.
    if (!profile) {
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
        await setDoc(doc(this.firestore, 'customers', firebaseUser.uid), newProfile);
        profile = newProfile;
        this.logService.log('REGISTER', 'AUTH', `Recovered orphan account: ${newProfile.email}`);
      } catch (err) {
        this.toast.error('Account error. Please contact support.');
        await signOut(this.auth);
        return;
      }
    }

    // SECURITY: Block customers from accessing the internal app.
    if (!INTERNAL_STAFF_ROLES.includes(profile.role)) {
      this.toast.error('Access denied. This portal is for internal staff only.');
      await this.logService.log('UNAUTHORIZED', 'AUTH', `Customer attempted internal app login: ${profile.email} (role: ${profile.role})`);
      await signOut(this.auth);
      return;
    }

    if (!profile.isActive) {
      this.toast.error('Your account has been deactivated. Contact an administrator.');
      await signOut(this.auth);
      return;
    }

    await this.logService.log('LOGIN', 'AUTH', `User logged in: ${profile.email} (${profile.role})`);
    const name = profile.displayName || profile.email.split('@')[0];
    this.toast.success(`Welcome back, ${name}!`);

    this.currentUser.set(firebaseUser);
    this.currentProfile.set(profile);
    this._authReady.next(true);

    this.router.navigate(['/portal']);
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

    // GOD MODE: Role impersonation — DEV ONLY. Disabled in production.
    const impersonatedRole = !environment.production ? this.devConfig.getImpersonatedRole() : null;

    return new Promise((resolve) => {
      this.userProfile$.subscribe({
        next: (profile) => {
          if (profile && impersonatedRole) {
            // Return a modified clone of the profile (dev only)
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
