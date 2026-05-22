/**
 * ==========================================================================
 * HabitQuest - Public Leaderboard Standings Manager (leaderboard.js)
 * ==========================================================================
 */

import { queryDocuments, setDocument, getDocument, mockWhere } from "./firebase-config.js";

/**
 * Synchronizes the user's public stats (name, level, XP, consistency)
 * into a safe, public-readable collection `publicProfiles`.
 * This protects user emails from being leaked on the login page.
 * 
 * @param {string} uid User ID
 */
export async function syncPublicProfile(uid) {
    if (!uid) return;
    try {
        // Fetch user document from users collection
        const userSnap = await getDocument("users", uid);
        if (!userSnap.exists()) return;
        
        const user = userSnap.data();
        // Do not sync admin users to the public standings
        if (user.role === "admin") return;
        
        // Fetch quests of this user to compute successfulDays and activeQuestCount
        const questsSnap = await queryDocuments("quests", mockWhere("userId", "==", uid));
        const quests = questsSnap.docs.map(d => d.data());
        
        // Filter out Archived & Abandoned quests for overall consistency stats
        const activeOrCompletedQuests = quests.filter(q => q.status !== "Archived" && q.status !== "Abandoned");
        const successfulDays = activeOrCompletedQuests.reduce((sum, q) => sum + (q.successfulDays || 0), 0);
        
        // Count running trackers (Active + Paused)
        const activeQuestCount = quests.filter(q => q.status === "Active" || q.status === "Paused").length;
        
        const publicData = {
            uid: uid,
            name: user.name || "Adventurer",
            level: user.level || 1,
            xp: user.xp || 0,
            successfulDays: successfulDays,
            activeQuestCount: activeQuestCount,
            updatedAt: "serverTimestamp()"
        };
        
        // Save to publicProfiles collection
        await setDocument("publicProfiles", uid, publicData);
        console.log(`[Leaderboard] Successfully synced public profile for user ${uid}`);
    } catch (err) {
        console.error(`[Leaderboard] Failed to sync public profile for user ${uid}:`, err);
    }
}

/**
 * Queries the top 5 public profiles sorted by performance metrics.
 * Ranking hierarchy:
 * 1. successfulDays desc
 * 2. xp desc
 * 3. level desc
 * 
 * @returns {Promise<Array>} List of top 5 profiles
 */
export async function loadPublicLeaderboard() {
    try {
        const snap = await queryDocuments("publicProfiles");
        const profiles = snap.docs.map(d => d.data());
        
        // Sort deterministically
        profiles.sort((a, b) => {
            const successfulDaysA = a.successfulDays || 0;
            const successfulDaysB = b.successfulDays || 0;
            if (successfulDaysB !== successfulDaysA) {
                return successfulDaysB - successfulDaysA;
            }
            
            const xpA = a.xp || 0;
            const xpB = b.xp || 0;
            if (xpB !== xpA) {
                return xpB - xpA;
            }
            
            const levelA = a.level || 1;
            const levelB = b.level || 1;
            return levelB - levelA;
        });
        
        return profiles.slice(0, 5);
    } catch (err) {
        console.error("[Leaderboard] Failed to load public leaderboard:", err);
        throw err;
    }
}

/**
 * Renders the public leaderboard inside the HTML element id `publicLeaderboardContainer`.
 */
export async function renderPublicLeaderboard() {
    const container = document.getElementById("publicLeaderboardContainer");
    if (!container) return;
    
    // Render Loading State (no outer card wrapper)
    container.innerHTML = `
        <div class="text-center py-md" style="padding: 20px 0;">
            <p class="secondary-text">Loading standings...</p>
        </div>
    `;
    
    try {
        const topUsers = await loadPublicLeaderboard();
        
        if (topUsers.length === 0) {
            container.innerHTML = `
                <div class="empty-state text-center" style="padding: 20px 0;">
                    <span class="empty-emoji">👑</span>
                    <h4>No legends on the board yet!</h4>
                    <p class="secondary-text">Be the first adventurer to complete quests and lead the standings.</p>
                </div>
            `;
            return;
        }
        
        let listRowsHtml = "";
        topUsers.forEach((user, idx) => {
            let rankText = `#${idx + 1}`;
            if (idx === 0) rankText = "🥇 1st";
            else if (idx === 1) rankText = "🥈 2nd";
            else if (idx === 2) rankText = "🥉 3rd";
            
            const displayName = user.name || "Adventurer";
            
            listRowsHtml += `
                <div class="leaderboard-row" style="display: flex; align-items: center; justify-content: space-between; border: var(--border-width) solid var(--border); border-radius: var(--border-radius-md); padding: 12px 16px; background-color: var(--card); box-shadow: 3px 3px 0 var(--shadow-color);">
                    <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex-grow: 1;">
                        <span class="rank-badge font-bold" style="min-width: 55px; font-family: 'Space Grotesk', sans-serif; font-size: 1rem; flex-shrink: 0;">${rankText}</span>
                        <span class="user-name font-bold" style="font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayName}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                        <span class="badge badge-outline" style="border-color: var(--border);">Lv. ${user.level || 1}</span>
                        <span class="badge badge-easy" style="background-color: var(--success); color: #FFFFFF; border-color: var(--border); white-space: nowrap;">🔥 ${user.successfulDays || 0} Days</span>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = `
            <div class="leaderboard-list-container mt-md" style="display: flex; flex-direction: column; gap: 12px;">
                ${listRowsHtml}
            </div>
        `;
    } catch (err) {
        console.error("Failed to render leaderboard:", err);
        const isPermissionError = err.message?.toLowerCase().includes("permission") || err.code?.toLowerCase().includes("permission");
        container.innerHTML = `
            <div class="text-center p-md" style="border: 2px dashed var(--danger); border-radius: var(--border-radius-md); margin-top: 15px;">
                <p class="secondary-text text-danger font-bold" style="font-size: 0.9rem;">⚠️ Connection Error</p>
                <p class="secondary-text text-xs mt-xs">Could not fetch public standings from database.</p>
                ${isPermissionError ? `
                    <div class="mt-sm text-left p-sm" style="font-size: 0.75rem; background-color: var(--accent-tint); border: 2px solid var(--border); border-radius: var(--border-radius-xs);">
                        <strong>💡 Rules deployment needed:</strong> Run <code style="background: var(--bg); padding: 1px 3px;">firebase deploy --only firestore:rules</code> to allow public reading.
                    </div>
                ` : `<p class="secondary-text text-xs italic mt-xs" style="font-size: 0.7rem; opacity: 0.7;">${err.message || err}</p>`}
            </div>
        `;
    }
}
