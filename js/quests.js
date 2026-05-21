/**
 * ==========================================================================
 * HabitQuest - Quests Campaigns Manager & Board Render
 * ==========================================================================
 */

import { 
    setDocument, 
    queryDocuments, 
    mockWhere, 
    updateDocument 
} from "./firebase-config.js";
import { currentUserProfile } from "./auth.js";
import { calculateDifficulty, calculateQuestHealth } from "./systems.js";
import { loadActiveMissionInterface } from "./missions.js";

// Active user session cache
export let userQuests = [];
export let todayMissions = {}; // Map of missionId -> missionData to check completions

// Helper: Get YYYY-MM-DD Date String in Client Local Time
export function getLocalTodayString() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// 1. CREATE QUEST SUBMISSION
export async function createQuest(title, reason, category, type, challengeDays, frequency, extraParams) {
    if (!currentUserProfile) return false;
    
    // Auto-calculate difficulty
    let effortVal = 1;
    if (type === "focus") {
        effortVal = extraParams.normalMinutes;
    } else if (type === "multi") {
        effortVal = extraParams.dailyTargets.length;
    }
    
    const diff = calculateDifficulty(type, challengeDays, frequency, effortVal);
    
    const questId = "q_" + Math.random().toString(36).substring(2, 9);
    const todayStr = getLocalTodayString();
    
    // Calculate endDate
    const endDateObj = new Date();
    endDateObj.setDate(endDateObj.getDate() + parseInt(challengeDays));
    const endStr = endDateObj.toISOString().split('T')[0];
    
    const questDoc = {
        questId: questId,
        userId: currentUserProfile.uid,
        userName: currentUserProfile.name,
        title: title,
        reason: reason,
        category: category,
        questType: type,
        status: "Active",
        challengeDays: parseInt(challengeDays),
        frequencyPerWeek: parseInt(frequency),
        minimumMinutes: parseInt(extraParams.minimumMinutes) || 0,
        normalMinutes: parseInt(extraParams.normalMinutes) || 0,
        perfectMinutes: parseInt(extraParams.perfectMinutes) || 0,
        dailyTargets: extraParams.dailyTargets || [],
        difficultyScore: diff.score,
        difficultyLevel: diff.level,
        currentChain: 0,
        bestChain: 0,
        successfulDays: 0,
        missedDays: 0,
        startDate: todayStr,
        endDate: endStr,
        createdAt: "serverTimestamp()",
        updatedAt: "serverTimestamp()"
    };
    
    await setDocument("quests", questId, questDoc);
    return true;
}

// 2. LOAD ALL USER QUESTS & TODAY'S LOGS
export async function loadUserQuestsAndTodayLogs() {
    if (!currentUserProfile) return;
    
    const uid = currentUserProfile.uid;
    const todayStr = getLocalTodayString();
    
    // A. Query Quests
    const questsSnap = await queryDocuments("quests", mockWhere("userId", "==", uid));
    userQuests = [];
    questsSnap.docs.forEach(doc => {
        userQuests.push(doc.data());
    });
    
    // B. Query Today's Daily Missions
    const missionsSnap = await queryDocuments("dailyMissions", mockWhere("userId", "==", uid), mockWhere("date", "==", todayStr));
    todayMissions = {};
    missionsSnap.docs.forEach(doc => {
        const data = doc.data();
        const deterministicId = `${data.questId}_${data.userId}_${data.date}`;
        todayMissions[deterministicId] = data;
    });
}

// 3. COMPUTE CAMPAIGN CONSISTENCY METRICS
export function computeQuestMetrics(quest) {
    const start = new Date(quest.startDate);
    const today = new Date();
    start.setHours(0,0,0,0);
    today.setHours(0,0,0,0);
    
    const diffTime = Math.abs(today - start);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1; // inclusive of start date
    const elapsedDays = Math.min(diffDays, quest.challengeDays);
    
    // Quest Progress toward end of challenge
    const questProgress = Math.round((quest.successfulDays / quest.challengeDays) * 100);
    
    // Completion rate relative to elapsed days
    const completionRate = elapsedDays > 0 
        ? Math.round((quest.successfulDays / elapsedDays) * 100)
        : 100;
        
    const health = calculateQuestHealth(completionRate);
    
    return {
        elapsedDays,
        questProgress,
        completionRate,
        health
    };
}

// 4. RENDER ACTIVE AND ARCHIVED BOARDS
export function renderQuestBoard(onQuestClicked) {
    const activeContainer = document.getElementById("activeQuestsContainer");
    const archiveContainer = document.getElementById("archiveQuestsContainer");
    const activeCountSpan = document.getElementById("totalSuccessfulDays"); // Mapping total consistent days in achievements
    const bestChainSpan = document.getElementById("bestChainOverall");
    
    if (!activeContainer) return;
    
    activeContainer.innerHTML = "";
    if (archiveContainer) archiveContainer.innerHTML = "";
    
    let activeQuests = userQuests.filter(q => q.status === "Active" || q.status === "Paused");
    let completedQuests = userQuests.filter(q => q.status === "Completed" || q.status === "Archived" || q.status === "Abandoned");
    
    // Stats overall calculations
    let totalConsistentDays = userQuests.reduce((sum, q) => sum + (q.successfulDays || 0), 0);
    let maxBestChain = userQuests.reduce((max, q) => Math.max(max, q.bestChain || 0), 0);
    
    if (activeCountSpan) activeCountSpan.innerText = `${totalConsistentDays} Days`;
    if (bestChainSpan) bestChainSpan.innerText = `${maxBestChain} Days`;
    
    // A. Active Board Rendering
    if (activeQuests.length === 0) {
        activeContainer.innerHTML = `
            <div class="card neo-card empty-state text-center">
                <span class="empty-emoji">📜</span>
                <h4>Your Quest Board is empty!</h4>
                <p>Post a Quest to begin your discipline tracking campaign.</p>
            </div>`;
    } else {
        activeQuests.forEach(quest => {
            const metrics = computeQuestMetrics(quest);
            const todayStr = getLocalTodayString();
            const missionId = `${quest.questId}_${quest.userId}_${todayStr}`;
            const isCompletedToday = !!todayMissions[missionId];
            const missionData = todayMissions[missionId];
            
            // Generate difficulty badge color
            let diffClass = "badge-easy";
            if (quest.difficultyLevel === "Medium") diffClass = "badge-medium";
            else if (quest.difficultyLevel === "Hard") diffClass = "badge-hard";
            else if (quest.difficultyLevel === "Extreme") diffClass = "badge-extreme";
            
            // Health colors classes
            let healthClass = "health-strong";
            if (metrics.health === "Stable") healthClass = "health-stable";
            else if (metrics.health === "At Risk") healthClass = "health-risk";
            else if (metrics.health === "Critical") healthClass = "health-critical";
            
            // Create Quest Card
            const card = document.createElement("div");
            card.className = "card neo-card quest-card";
            
            card.innerHTML = `
                <div class="quest-card-header">
                    <div>
                        <span class="badge badge-category">${quest.category}</span>
                        <h4 class="quest-card-title mt-xs" data-id="${quest.questId}">${quest.title}</h4>
                    </div>
                    <div class="quest-card-badges">
                        <span class="badge ${diffClass}">${quest.difficultyLevel}</span>
                        <span class="badge badge-primary">⚡ ${quest.currentChain} Chain</span>
                    </div>
                </div>
                
                <div class="quest-card-body">
                    <div class="quest-card-desc-box">
                        <p class="quest-reason-text">"${quest.reason}"</p>
                        
                        <div class="progress-container">
                            <div class="progress-fill fill-success" style="width: ${metrics.questProgress}%;"></div>
                        </div>
                        
                        <div class="quest-stats-bar mt-xs">
                            <span>📅 progress: ${quest.successfulDays}/${quest.challengeDays} Days (${metrics.questProgress}%)</span>
                            <span>📈 rate: ${metrics.completionRate}%</span>
                            <span>❤️ health: <span class="${healthClass} font-bold">${metrics.health}</span></span>
                        </div>
                    </div>
                    
                    <div>
                        ${isCompletedToday 
                            ? `<button class="btn btn-sm btn-outline" disabled>✓ ${missionData.clearLevel} Clear</button>` 
                            : `<button class="btn btn-sm btn-primary font-bold btn-action-trigger" data-id="${quest.questId}">⚔️ Launch</button>`
                        }
                    </div>
                </div>
            `;
            
            // Add Listeners
            card.querySelector(".quest-card-title").addEventListener("click", () => onQuestClicked(quest.questId));
            const actBtn = card.querySelector(".btn-action-trigger");
            if (actBtn) actBtn.addEventListener("click", () => onQuestClicked(quest.questId));
            
            activeContainer.appendChild(card);
        });
    }
    
    // B. Completed & Archived Render
    if (archiveContainer) {
        if (completedQuests.length === 0) {
            archiveContainer.innerHTML = `<p class="secondary-text text-center italic">No completed or archived quests found.</p>`;
        } else {
            completedQuests.forEach(quest => {
                const card = document.createElement("div");
                card.className = "card neo-card quest-card opacity-muted";
                card.innerHTML = `
                    <div class="quest-card-header">
                        <div>
                            <span class="badge badge-category">${quest.category}</span>
                            <h4 class="quest-card-title mt-xs" data-id="${quest.questId}">${quest.title}</h4>
                        </div>
                        <div>
                            <span class="badge badge-outline">${quest.status}</span>
                        </div>
                    </div>
                    <div class="quest-card-body">
                        <p class="quest-reason-text italic">"${quest.reason}"</p>
                        <span>Campaign Result: <strong>${quest.successfulDays} / ${quest.challengeDays} Days</strong> consistent check-ins.</span>
                    </div>
                `;
                
                card.querySelector(".quest-card-title").addEventListener("click", () => onQuestClicked(quest.questId));
                archiveContainer.appendChild(card);
            });
        }
    }
}

// 5. CAMPAIGN STATUS CONTROL ACTIONS
export async function pauseQuestCampaign(questId, currentPauseState) {
    const newStatus = currentPauseState === "Paused" ? "Active" : "Paused";
    await updateDocument("quests", questId, { status: newStatus });
    await loadUserQuestsAndTodayLogs();
}

export async function archiveQuestCampaign(questId) {
    await updateDocument("quests", questId, { status: "Archived" });
    await loadUserQuestsAndTodayLogs();
}

export async function deleteQuestCampaign(questId) {
    await updateDocument("quests", questId, { status: "Archived" }); // Safe soft-deletion rules
    await loadUserQuestsAndTodayLogs();
}
