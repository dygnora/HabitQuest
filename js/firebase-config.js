/**
 * ==========================================================================
 * HabitQuest - Dual-Mode Firebase & Local Mock Configurator
 * ==========================================================================
 * 
 * If you have provisioned your Firebase project, replace the placeholder configuration
 * credentials below. If the credentials remain placeholders and the application is
 * running locally (localhost / 127.0.0.1), it transparently falls back to Mock Mode
 * using LocalStorage.
 * 
 * Mock Mode is strictly blocked on production domains (e.g. Netlify).
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    signInWithPopup, 
    GoogleAuthProvider, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    collection, 
    query, 
    where, 
    getDocs, 
    addDoc, 
    serverTimestamp, 
    increment,
    runTransaction
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 1. DYNAMIC FIREBASE CONFIG FROM ENV
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "YOUR_API_KEY_HERE",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "YOUR_MESSAGING_SENDER_ID",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "YOUR_APP_ID",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || ""
};

// 2. CHECK ENVIRONMENT & VALIDATE DOMAIN
const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const isPlaceholder = firebaseConfig.apiKey.includes("YOUR_API_KEY");

let dbInstance = null;
let authInstance = null;
let isMock = false;

// Enforce Domain Security Rules
if (isPlaceholder) {
    if (!isLocal) {
        // Hard Lock Production Domain if Firebase is missing
        console.error("HabitQuest ERROR: Production deployment detected but Firebase remains unconfigured. Fallback Mock Mode is blocked.");
        document.addEventListener("DOMContentLoaded", () => {
            const errorView = document.getElementById("configErrorView");
            const authView = document.getElementById("authView");
            if (errorView) errorView.classList.remove("hidden");
            if (authView) authView.classList.add("hidden");
        });
    } else {
        isMock = true;
        console.warn("HabitQuest Local Dev: Firebase credentials are placeholder. Initializing Local Mock Fallback.");
    }
}

// 3. INITIALIZE REAL FIREBASE OR MOCK PROXY
if (!isMock) {
    try {
        const app = initializeApp(firebaseConfig);
        authInstance = getAuth(app);
        dbInstance = getFirestore(app);
    } catch (err) {
        console.error("Firebase Initialization Failed! Defaulting to Mock Mode in local environment if allowed.", err);
        if (isLocal) {
            isMock = true;
        } else {
            document.addEventListener("DOMContentLoaded", () => {
                const errorView = document.getElementById("configErrorView");
                if (errorView) errorView.classList.remove("hidden");
            });
        }
    }
}

// ==========================================================================
// 4. MOCK DATABASE ENGINE IMPLEMENTATION (LocalStorage Proxy)
// ==========================================================================
const mockDb = {
    storageKey: "habitquest_mock_db",
    
    getData() {
        let raw = localStorage.getItem(this.storageKey);
        if (!raw) {
            const initial = { users: {}, quests: {}, dailyMissions: {} };
            localStorage.setItem(this.storageKey, JSON.stringify(initial));
            return initial;
        }
        return JSON.parse(raw);
    },
    
    saveData(data) {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
    }
};

// Mock Authentication Provider
const mockAuth = {
    currentUser: null,
    listeners: [],
    
    onAuthStateChanged(callback) {
        this.listeners.push(callback);
        // Load active session from localStorage
        const stored = localStorage.getItem("habitquest_mock_session");
        if (stored) {
            this.currentUser = JSON.parse(stored);
        } else {
            this.currentUser = null;
        }
        // Fire callback immediately
        setTimeout(() => callback(this.currentUser), 50);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    },
    
    async signInWithGoogle() {
        // Simulates Google login popup for users
        const mockUid = "mock_user_" + Math.random().toString(36).substring(2, 9);
        const mockUser = {
            uid: mockUid,
            displayName: "Hero Adventurer",
            email: "hero@adventurer.com",
            role: "user",
            provider: "google"
        };
        this.currentUser = mockUser;
        localStorage.setItem("habitquest_mock_session", JSON.stringify(mockUser));
        this.listeners.forEach(l => l(mockUser));
        return { user: mockUser };
    },
    
    async signInWithEmailAndPassword(email, password) {
        // Validates mock admin account (restricted strictly to local dev environments)
        // Credentials: admin@habitquest.com / admin123
        if (email === "admin@habitquest.com" && password === "admin123") {
            const mockAdmin = {
                uid: "mock_admin_guildmaster",
                displayName: "Guild Master",
                email: "admin@habitquest.com",
                role: "admin",
                provider: "password"
            };
            this.currentUser = mockAdmin;
            localStorage.setItem("habitquest_mock_session", JSON.stringify(mockAdmin));
            this.listeners.forEach(l => l(mockAdmin));
            return { user: mockAdmin };
        } else {
            throw new Error("auth/wrong-password - Invalid credentials.");
        }
    },
    
    async signOut() {
        this.currentUser = null;
        localStorage.removeItem("habitquest_mock_session");
        this.listeners.forEach(l => l(null));
    }
};

// Export Modules Wrapper
export const isMockMode = isMock;
export const auth = isMock ? mockAuth : authInstance;
export const db = isMock ? mockDb : dbInstance;

// Re-export Real Firebase SDK API wrapper functions that adapt to Mock mode
export async function getDocument(collectionName, docId) {
    if (isMock) {
        const data = mockDb.getData();
        return {
            exists: () => !!data[collectionName]?.[docId],
            data: () => data[collectionName]?.[docId] || null,
            id: docId
        };
    } else {
        const docRef = doc(dbInstance, collectionName, docId);
        return await getDoc(docRef);
    }
}

export async function setDocument(collectionName, docId, dataObject) {
    if (isMock) {
        const data = mockDb.getData();
        if (!data[collectionName]) data[collectionName] = {};
        
        // Handle firestore serverTimestamp simulated equivalent
        const sanitized = { ...dataObject };
        for (const key in sanitized) {
            if (sanitized[key] === "serverTimestamp()") {
                sanitized[key] = new Date().toISOString();
            }
        }
        
        data[collectionName][docId] = sanitized;
        mockDb.saveData(data);
        return true;
    } else {
        const docRef = doc(dbInstance, collectionName, docId);
        const toSave = { ...dataObject };
        for (const key in toSave) {
            if (toSave[key] === "serverTimestamp()") {
                toSave[key] = serverTimestamp();
            }
        }
        await setDoc(docRef, toSave);
        return true;
    }
}

export async function updateDocument(collectionName, docId, dataObject) {
    if (isMock) {
        const data = mockDb.getData();
        if (!data[collectionName]?.[docId]) return false;
        
        const docData = data[collectionName][docId];
        
        for (const key in dataObject) {
            const val = dataObject[key];
            if (val && typeof val === "object" && val.type === "increment") {
                docData[key] = (docData[key] || 0) + val.value;
            } else {
                docData[key] = val;
            }
        }
        
        data[collectionName][docId] = docData;
        mockDb.saveData(data);
        return true;
    } else {
        const docRef = doc(dbInstance, collectionName, docId);
        const updatePayload = {};
        for (const key in dataObject) {
            const val = dataObject[key];
            if (val && typeof val === "object" && val.type === "increment") {
                updatePayload[key] = increment(val.value);
            } else {
                updatePayload[key] = val;
            }
        }
        await updateDoc(docRef, updatePayload);
        return true;
    }
}

export async function queryDocuments(collectionName, ...queryConstraints) {
    if (isMock) {
        const data = mockDb.getData();
        const items = data[collectionName] ? Object.values(data[collectionName]) : [];
        let filtered = [...items];
        
        // Process mock query constraints
        for (const constraint of queryConstraints) {
            if (constraint.type === "where") {
                const { field, op, val } = constraint;
                filtered = filtered.filter(item => {
                    if (op === "==") return item[field] === val;
                    if (op === ">=") return item[field] >= val;
                    if (op === "<=") return item[field] <= val;
                    return true;
                });
            }
        }
        
        return {
            docs: filtered.map(item => ({
                data: () => item,
                id: item.id || item.questId || item.userId || ""
            }))
        };
    } else {
        const collRef = collection(dbInstance, collectionName);
        const firestoreConstraints = [];
        
        for (const constraint of queryConstraints) {
            if (constraint.type === "where") {
                firestoreConstraints.push(where(constraint.field, constraint.op, constraint.val));
            }
        }
        
        const q = query(collRef, ...firestoreConstraints);
        return await getDocs(q);
    }
}

// Helpers for mock querying
export function mockWhere(field, op, val) {
    return { type: "where", field, op, val };
}

// Helper for simulated increment
export function mockIncrement(val) {
    return { type: "increment", value: val };
}

// Transaction simulation wrapper to check duplicate and finalize safely
export async function executeMissionTransaction(missionId, userId, questId, rewardGold, rewardXp, levelIncrement, chainAction, shieldDeduct, updatedQuestStats, newMissionData) {
    if (isMock) {
        const data = mockDb.getData();
        if (!data.dailyMissions) data.dailyMissions = {};
        if (!data.quests) data.quests = {};
        if (!data.users) data.users = {};
        
        // 1. Check duplicate
        if (data.dailyMissions[missionId]) {
            throw new Error("mission/already-finalized");
        }
        
        // 2. Create mission record
        data.dailyMissions[missionId] = {
            ...newMissionData,
            createdAt: new Date().toISOString()
        };
        
        // 3. Update Quest
        if (data.quests[questId]) {
            data.quests[questId] = {
                ...data.quests[questId],
                ...updatedQuestStats,
                updatedAt: new Date().toISOString()
            };
        }
        
        // 4. Update User Profile
        if (data.users[userId]) {
            const user = data.users[userId];
            user.gold = (user.gold || 0) + rewardGold;
            user.xp = (user.xp || 0) + rewardXp;
            user.level = (user.level || 1) + levelIncrement;
            
            if (shieldDeduct) {
                user.inventory.streakShield = Math.max(0, (user.inventory.streakShield || 0) - 1);
            }
        }
        
        mockDb.saveData(data);
        return true;
    } else {
        // Run Real Firestore Transaction!
        await runTransaction(dbInstance, async (transaction) => {
            const missionRef = doc(dbInstance, "dailyMissions", missionId);
            const questRef = doc(dbInstance, "quests", questId);
            const userRef = doc(dbInstance, "users", userId);
            
            // Check duplicate mission document
            const missionDoc = await transaction.get(missionRef);
            if (missionDoc.exists()) {
                throw new Error("mission/already-finalized");
            }
            
            // Get user to do correct calculation
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) {
                throw new Error("user/not-found");
            }
            const userData = userDoc.data();
            
            // Calculate updates
            const currentGold = userData.gold || 0;
            const currentXp = userData.xp || 0;
            const currentLevel = userData.level || 1;
            
            const newGold = currentGold + rewardGold;
            const newXp = currentXp + rewardXp;
            const newLevel = currentLevel + levelIncrement;
            
            const userUpdates = {
                gold: newGold,
                xp: newXp,
                level: newLevel
            };
            
            if (shieldDeduct) {
                const currentShield = userData.inventory?.streakShield || 0;
                userUpdates["inventory.streakShield"] = Math.max(0, currentShield - 1);
            }
            
            // Write mission document
            transaction.set(missionRef, {
                ...newMissionData,
                createdAt: serverTimestamp()
            });
            
            // Update quest statistics
            transaction.update(questRef, {
                ...updatedQuestStats,
                updatedAt: serverTimestamp()
            });
            
            // Update user balance
            transaction.update(userRef, userUpdates);
        });
        return true;
    }
}
