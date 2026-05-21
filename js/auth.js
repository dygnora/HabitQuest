/**
 * ==========================================================================
 * HabitQuest - Authentication & Identity Session Manager
 * ==========================================================================
 */

import { 
    auth, 
    isMockMode, 
    getDocument, 
    setDocument 
} from "./firebase-config.js";
import { 
    GoogleAuthProvider, 
    signInWithPopup, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Global Session Variables
export let currentUserProfile = null;
let sessionStateListener = null;

// Register session change listener
export function registerAuthStateListener(onSessionChanged) {
    sessionStateListener = onSessionChanged;
    
    // Wire Firebase / Mock state listener
    onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
            try {
                // Securely ensure that the user profile document exists in the database.
                // This prevents race conditions where the auth state fires before login completes.
                const snap = await getDocument("users", firebaseUser.uid);
                if (!snap.exists()) {
                    if (firebaseUser.email === "admin@habitquest.com") {
                        console.log(`Auto-provisioning missing Admin Firestore profile in state listener for: ${firebaseUser.uid}`);
                        const adminProfile = {
                            name: "Guild Master",
                            email: "admin@habitquest.com",
                            role: "admin",
                            provider: "password",
                            createdAt: "serverTimestamp()"
                        };
                        await setDocument("users", firebaseUser.uid, adminProfile);
                    } else {
                        console.log(`Initializing default adventurer profile for: ${firebaseUser.uid}`);
                        const nameStr = firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "Epic Adventurer";
                        const defaultProfile = {
                            name: nameStr,
                            email: firebaseUser.email,
                            role: "user",
                            provider: "google",
                            gold: 0,
                            xp: 0,
                            level: 1,
                            activeTitle: "Rookie Adventurer",
                            activeTheme: "default",
                            inventory: {
                                streakShield: 0,
                                titleRookie: true,
                                titleFocusKeeper: false,
                                titleChainMaster: false,
                                themeMidnight: false,
                                themeForest: false
                            },
                            createdAt: "serverTimestamp()"
                        };
                        await setDocument("users", firebaseUser.uid, defaultProfile);
                    }
                }

                currentUserProfile = await loadUserProfile(firebaseUser);
                if (currentUserProfile) {
                    // Check Role Mismatch Security Constraints
                    if (currentUserProfile.role === "admin" && currentUserProfile.provider !== "password") {
                        alert("Access Denied: Admin roles are strictly restricted to password authentication.");
                        await logoutUser();
                        return;
                    }
                    if (currentUserProfile.role === "user" && currentUserProfile.provider !== "google") {
                        alert("Access Denied: Adventurer roles are strictly restricted to Google accounts.");
                        await logoutUser();
                        return;
                    }
                    
                    onSessionChanged(currentUserProfile);
                } else {
                    // Profile document error
                    console.error("Critical: User Profile Document is missing in Database.");
                    await logoutUser();
                }
            } catch (err) {
                console.error("Profile load or mismatch verification failed:", err);
                await logoutUser();
            }
        } else {
            currentUserProfile = null;
            onSessionChanged(null);
        }
    });
}

// 1. ADVENTURER SIGN IN (Google Sign-In)
export async function loginWithGoogle() {
    if (isMockMode) {
        // Mock Popup Login
        await auth.signInWithGoogle();
        return true;
    } else {
        // Real Google Login
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
        return true;
    }
}

// 2. GUILD MASTER SIGN IN (Admin Email/Password)
export async function loginAsAdmin(email, password) {
    if (isMockMode) {
        // Local Mock Admin Credentials Validation
        await auth.signInWithEmailAndPassword(email, password);
        return true;
    } else {
        // Real Firebase Auth Admin Validation
        const result = await signInWithEmailAndPassword(auth, email, password);
        const user = result.user;
        
        // Double-check profile exists, auto-provision it if missing, and validate role
        const profileSnap = await getDocument("users", user.uid);
        if (!profileSnap.exists()) {
            console.log(`Auto-provisioning missing Admin Firestore profile for: ${user.uid}`);
            const adminProfile = {
                name: "Guild Master",
                email: "admin@habitquest.com",
                role: "admin",
                provider: "password",
                createdAt: "serverTimestamp()"
            };
            await setDocument("users", user.uid, adminProfile);
        } else {
            const profile = profileSnap.data();
            if (profile.role !== "admin") {
                await signOut(auth);
                throw new Error("auth/unauthorized-role - Authorized access is locked to administrative roles.");
            }
        }
        
        return true;
    }
}

// 3. SECURE SESSION SIGNOUT
export async function logoutUser() {
    if (isMockMode) {
        await auth.signOut();
    } else {
        await signOut(auth);
    }
}

// 4. LOAD & CONVERT PROFILE TO CURRENT SCHEMA
async function loadUserProfile(firebaseUser) {
    const snap = await getDocument("users", firebaseUser.uid);
    if (snap.exists()) {
        const data = snap.data();
        return {
            uid: firebaseUser.uid,
            ...data
        };
    }
    return null;
}

// Profile auto-provisioning is securely handled by registerAuthStateListener upon first auth event
