/**
 * ==========================================================================
 * HabitQuest - Daily Missions Execution Controller & Timer
 * ==========================================================================
 */

import { executeMissionTransaction, getDocument } from "./firebase-config.js";
import { currentUserProfile } from "./auth.js";
import { calculateRewards, calculateLevel } from "./systems.js";
import { getLocalTodayString, loadUserQuestsAndTodayLogs } from "./quests.js";

// Session execution variables
let activeInterval = null;
let elapsedSeconds = 0;
let timerRunning = false;
let focusMin = 10;
let focusNormal = 30;
let focusPerfect = 60;
let isDevSecondsMode = true; // Prototyping helper: counts stopwatch in seconds instead of minutes for instant verification

// Temp Multi Mission check-in caches
let multiMissionTargets = {};

// Load UI controllers references
let onMissionLoggedCallback = null;

export function registerMissionLoggedCallback(callback) {
    onMissionLoggedCallback = callback;
}

// 1. DYNAMICALLY LOAD TODAYS MISSION INTERFACE
export function loadActiveMissionInterface(container, quest, user) {
    clearInterval(activeInterval);
    activeInterval = null;
    timerRunning = false;
    elapsedSeconds = 0;
    
    container.innerHTML = "";
    
    // Check if duplicate mission already registered today
    const todayStr = getLocalTodayString();
    const deterministicId = `${quest.questId}_${user.uid}_${todayStr}`;
    
    if (quest.status !== "Active") {
        container.innerHTML = `
            <div class="text-center p-md">
                <p class="secondary-text italic text-danger">⚠️ Daily check-ins are restricted for paused or completed quests.</p>
            </div>`;
        return;
    }
    
    // A. SIMPLE QUEST RENDERING
    if (quest.questType === "simple") {
        container.innerHTML = `
            <div class="simple-quest-control text-center p-md">
                <p class="mb-md font-bold text-lg">Have you accomplished this quest today?</p>
                <div class="grid-2col gap-md">
                    <button id="btnCompleteSimple" class="btn btn-primary font-bold">🌟 Complete Mission</button>
                    <button id="btnMissSimple" class="btn btn-danger-outline font-bold">⚠️ Mark as Missed</button>
                </div>
            </div>
        `;
        
        document.getElementById("btnCompleteSimple").addEventListener("click", () => {
            finalizeMissionProcess(quest, "Normal", 0, {});
        });
        
        document.getElementById("btnMissSimple").addEventListener("click", () => {
            triggerFailureFlow(quest);
        });
        
    // B. FOCUS QUEST RENDERING (Timer stopwatch)
    } else if (quest.questType === "focus") {
        focusMin = quest.minimumMinutes || 10;
        focusNormal = quest.normalMinutes || 30;
        focusPerfect = quest.perfectMinutes || 60;
        
        container.innerHTML = `
            <div class="focus-quest-control">
                <!-- Dev Fast Mode Control Badge -->
                <div class="flex justify-between align-center mb-md">
                    <span class="mini-desc italic">Self-discipline stopwatch tracking</span>
                    <label class="flex align-center gap-xs font-bold pointer" style="font-size: 0.75rem;">
                        <input type="checkbox" id="chkDevSeconds" ${isDevSecondsMode ? "checked" : ""}>
                        🚀 Dev Mode (Seconds as Minutes)
                    </label>
                </div>
                
                <div id="stopwatchDisplay" class="timer-display">00:00:00</div>
                
                <div class="timer-target-display">
                    <span id="thresholdMinPill" class="timer-threshold-pill">Min: ${focusMin}m</span>
                    <span id="thresholdNormalPill" class="timer-threshold-pill">Normal: ${focusNormal}m</span>
                    <span id="thresholdPerfectPill" class="timer-threshold-pill">Perfect: ${focusPerfect}m</span>
                </div>
                
                <div class="clear-level-preview">
                    <span class="font-bold">Clear Tier Eligible:</span>
                    <span id="timerClearTierBadge" class="badge badge-outline text-danger">NOT ELIGIBLE</span>
                </div>
                
                <div class="grid-4col gap-xs mt-md">
                    <button id="btnTimerStart" class="btn btn-primary btn-sm font-bold">Start</button>
                    <button id="btnTimerPause" class="btn btn-outline btn-sm font-bold" disabled>Pause</button>
                    <button id="btnTimerResume" class="btn btn-outline btn-sm font-bold" disabled>Resume</button>
                    <button id="btnTimerStop" class="btn btn-dark btn-sm font-bold" disabled>Stop</button>
                </div>
                
                <button id="btnTimerFinalize" class="btn btn-primary full-width font-bold mt-md" disabled>
                    🏆 Finalize Daily Mission
                </button>
            </div>
        `;
        
        // Add Timer Watchers & Event Handlers
        const devChk = document.getElementById("chkDevSeconds");
        if (devChk) {
            devChk.addEventListener("change", (e) => {
                isDevSecondsMode = e.target.checked;
                updateStopwatchUI();
            });
        }
        
        document.getElementById("btnTimerStart").addEventListener("click", () => startStopwatch(quest));
        document.getElementById("btnTimerPause").addEventListener("click", () => pauseStopwatch());
        document.getElementById("btnTimerResume").addEventListener("click", () => resumeStopwatch(quest));
        document.getElementById("btnTimerStop").addEventListener("click", () => stopStopwatch(quest));
        document.getElementById("btnTimerFinalize").addEventListener("click", () => finalizeFocusMission(quest));
        
        updateStopwatchUI();
        
    // C. MULTI MISSION QUEST RENDERING (Checklist checklist)
    } else if (quest.questType === "multi") {
        multiMissionTargets = {};
        quest.dailyTargets.forEach(t => {
            multiMissionTargets[t.id] = { name: t.name, done: false, checkedAt: null };
        });
        
        container.innerHTML = `
            <div class="multi-quest-control">
                <p class="secondary-text mb-md font-bold">Check off completed sub-targets for today:</p>
                <div id="subtargetsChecklistContainer" class="checklist-targets-box">
                    <!-- Loaded dynamically below -->
                </div>
                
                <div class="clear-level-preview">
                    <span class="font-bold">Progress Rate: <span id="multiProgressText" class="text-primary">0/0 Done</span></span>
                    <span id="multiClearTierBadge" class="badge badge-outline text-danger">MISSED</span>
                </div>
                
                <button id="btnFinalizeMulti" class="btn btn-primary full-width font-bold mt-md">
                    🏆 Finalize Daily Mission Checklist
                </button>
            </div>
        `;
        
        renderMultiChecklistUI(quest);
        document.getElementById("btnFinalizeMulti").addEventListener("click", () => finalizeMultiMission(quest));
    }
}

// ==========================================================================
// 2. FOCUS TIMER STOPWATCH SYSTEM
// ==========================================================================
function startStopwatch(quest) {
    if (timerRunning) return;
    timerRunning = true;
    
    document.getElementById("btnTimerStart").disabled = true;
    document.getElementById("btnTimerPause").disabled = false;
    document.getElementById("btnTimerStop").disabled = false;
    
    activeInterval = setInterval(() => {
        elapsedSeconds++;
        updateStopwatchUI();
    }, 1000);
}

function pauseStopwatch() {
    if (!timerRunning) return;
    timerRunning = false;
    clearInterval(activeInterval);
    
    document.getElementById("btnTimerPause").disabled = true;
    document.getElementById("btnTimerResume").disabled = false;
}

function resumeStopwatch(quest) {
    if (timerRunning) return;
    timerRunning = true;
    
    document.getElementById("btnTimerResume").disabled = true;
    document.getElementById("btnTimerPause").disabled = false;
    
    activeInterval = setInterval(() => {
        elapsedSeconds++;
        updateStopwatchUI();
    }, 1000);
}

function stopStopwatch(quest) {
    timerRunning = false;
    clearInterval(activeInterval);
    
    document.getElementById("btnTimerPause").disabled = true;
    document.getElementById("btnTimerResume").disabled = true;
    document.getElementById("btnTimerStop").disabled = true;
    document.getElementById("btnTimerStart").disabled = false;
    
    updateStopwatchUI();
}

function updateStopwatchUI() {
    const display = document.getElementById("stopwatchDisplay");
    if (!display) return;
    
    const hrs = String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0');
    const mins = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0');
    const secs = String(elapsedSeconds % 60).padStart(2, '0');
    display.innerText = `${hrs}:${mins}:${secs}`;
    
    // Check computed elapsed time units depending on prototyping speed modes
    const currentUnits = isDevSecondsMode ? elapsedSeconds : Math.floor(elapsedSeconds / 60);
    
    // Evaluate thresholds
    const minPill = document.getElementById("thresholdMinPill");
    const normalPill = document.getElementById("thresholdNormalPill");
    const perfectPill = document.getElementById("thresholdPerfectPill");
    const tierBadge = document.getElementById("timerClearTierBadge");
    const finalizeBtn = document.getElementById("btnTimerFinalize");
    
    let tier = "Missed";
    
    if (currentUnits >= focusPerfect) {
        tier = "Perfect";
        if (minPill) minPill.className = "timer-threshold-pill reached";
        if (normalPill) normalPill.className = "timer-threshold-pill reached";
        if (perfectPill) perfectPill.className = "timer-threshold-pill reached";
    } else if (currentUnits >= focusNormal) {
        tier = "Normal";
        if (minPill) minPill.className = "timer-threshold-pill reached";
        if (normalPill) normalPill.className = "timer-threshold-pill reached";
        if (perfectPill) perfectPill.className = "timer-threshold-pill";
    } else if (currentUnits >= focusMin) {
        tier = "Minimum";
        if (minPill) minPill.className = "timer-threshold-pill reached";
        if (normalPill) normalPill.className = "timer-threshold-pill";
        if (perfectPill) perfectPill.className = "timer-threshold-pill";
    } else {
        tier = "Missed";
        if (minPill) minPill.className = "timer-threshold-pill";
        if (normalPill) normalPill.className = "timer-threshold-pill";
        if (perfectPill) perfectPill.className = "timer-threshold-pill";
    }
    
    if (tierBadge) {
        if (tier === "Missed") {
            tierBadge.className = "badge badge-outline text-danger";
            tierBadge.innerText = "NOT ELIGIBLE";
            if (finalizeBtn) finalizeBtn.disabled = true;
        } else {
            tierBadge.className = `badge badge-${tier.toLowerCase()}`;
            tierBadge.innerText = `${tier} Clear`;
            if (finalizeBtn) finalizeBtn.disabled = false;
        }
    }
}

function finalizeFocusMission(quest) {
    const elapsedMinutes = isDevSecondsMode ? elapsedSeconds : Math.floor(elapsedSeconds / 60);
    let clearTier = "Missed";
    
    if (elapsedMinutes >= focusPerfect) clearTier = "Perfect";
    else if (elapsedMinutes >= focusNormal) clearTier = "Normal";
    else if (elapsedMinutes >= focusMin) clearTier = "Minimum";
    
    if (clearTier === "Missed") {
        alert("Cannot finalize: minimum time is not met.");
        return;
    }
    
    finalizeMissionProcess(quest, clearTier, elapsedMinutes, {});
}

// ==========================================================================
// 3. MULTI MISSION CHECKLIST ENGINE
// ==========================================================================
function renderMultiChecklistUI(quest) {
    const container = document.getElementById("subtargetsChecklistContainer");
    if (!container) return;
    container.innerHTML = "";
    
    quest.dailyTargets.forEach(target => {
        const item = document.createElement("div");
        item.className = "subtarget-item";
        
        const isDone = multiMissionTargets[target.id].done;
        
        item.innerHTML = `
            <div class="subtarget-checkbox ${isDone ? "checked" : ""}">
                ${isDone ? "✓" : ""}
            </div>
            <span>${target.name}</span>
        `;
        
        item.addEventListener("click", () => {
            multiMissionTargets[target.id].done = !multiMissionTargets[target.id].done;
            multiMissionTargets[target.id].checkedAt = multiMissionTargets[target.id].done ? new Date().toISOString() : null;
            renderMultiChecklistUI(quest);
            updateMultiProgressUI(quest);
        });
        
        container.appendChild(item);
    });
}

function updateMultiProgressUI(quest) {
    const total = quest.dailyTargets.length;
    const done = Object.values(multiMissionTargets).filter(t => t.done).length;
    const rate = total > 0 ? (done / total) * 100 : 0;
    
    const progressText = document.getElementById("multiProgressText");
    const tierBadge = document.getElementById("multiClearTierBadge");
    
    if (progressText) progressText.innerText = `${done}/${total} Checked (${Math.round(rate)}%)`;
    
    let tier = "Missed";
    if (rate >= 100) tier = "Perfect";
    else if (rate >= 70) tier = "Normal";
    else if (rate === 0) tier = "Missed";
    else if (rate >= 50) tier = "Minimum";
    else tier = "Missed";
    
    if (tierBadge) {
        tierBadge.className = `badge badge-${tier.toLowerCase()}`;
        tierBadge.innerText = `${tier} Clear`;
    }
}

function finalizeMultiMission(quest) {
    const total = quest.dailyTargets.length;
    const done = Object.values(multiMissionTargets).filter(t => t.done).length;
    const rate = total > 0 ? (done / total) * 100 : 0;
    
    let clearTier = "Missed";
    if (rate >= 100) clearTier = "Perfect";
    else if (rate >= 70) clearTier = "Normal";
    else if (rate >= 50) clearTier = "Minimum";
    
    if (clearTier === "Missed") {
        const confirmMiss = confirm("You have completed less than 50% of your checklist. Finalizing will log this mission as Missed. Do you want to continue?");
        if (!confirmMiss) return;
        triggerFailureFlow(quest);
    } else {
        finalizeMissionProcess(quest, clearTier, 0, multiMissionTargets);
    }
}

// ==========================================================================
// 4. SECURE TRANSACTIONAL MISSION FINALIZATION WORKFLOW
// ==========================================================================
export async function finalizeMissionProcess(quest, clearLevel, completedMinVal, targetsObj, failureReason = "") {
    if (!currentUserProfile) return;
    
    // Disable form submissions immediately to prevent duplicate requests
    disableAllMissionActions();
    
    const userId = currentUserProfile.uid;
    const todayStr = getLocalTodayString();
    const missionId = `${quest.questId}_${userId}_${todayStr}`;
    
    try {
        // Calculate Rewards XP and Gold using Systems module
        const reward = calculateRewards(quest.difficultyLevel, clearLevel);
        
        // Load latest user profile stats to compute leveling
        const userSnap = await getDocument("users", userId);
        const user = userSnap.data();
        
        let newXp = (user.xp || 0) + reward.xp;
        let newLevel = calculateLevel(newXp);
        let levelInc = Math.max(0, newLevel - (user.level || 1));
        
        // Handle Streak Shield Mechanics
        let shieldDeduct = false;
        let finalChain = quest.currentChain || 0;
        let clearStatus = clearLevel;
        
        if (clearLevel === "Missed") {
            const hasShield = (user.inventory?.streakShield || 0) > 0;
            if (hasShield) {
                // Streak Shield deducts, preserve chain
                shieldDeduct = true;
                clearStatus = "Shielded Missed";
                reward.xp = 0;
                reward.gold = 0;
                levelInc = 0;
                console.log("Streak Shield utilized! Preserving chain.");
            } else {
                // Chain resets
                finalChain = 0;
            }
        } else {
            // Normal rewards, chain +1
            finalChain += 1;
        }
        
        // Evaluate Best Chain Update
        let finalBestChain = quest.bestChain || 0;
        if (finalChain > finalBestChain) {
            finalBestChain = finalChain;
        }
        
        // Successful check-ins sum increment
        const finalSuccessfulDays = clearLevel !== "Missed" 
            ? (quest.successfulDays || 0) + 1 
            : (quest.successfulDays || 0);
            
        const finalMissedDays = clearLevel === "Missed" 
            ? (quest.missedDays || 0) + 1 
            : (quest.missedDays || 0);
            
        // Check Campaign Completion Status
        let finalStatus = quest.status;
        if (finalSuccessfulDays >= quest.challengeDays) {
            finalStatus = "Completed";
        }
        
        // Pack Quest updates
        const updatedQuestStats = {
            currentChain: finalChain,
            bestChain: finalBestChain,
            successfulDays: finalSuccessfulDays,
            missedDays: finalMissedDays,
            status: finalStatus
        };
        
        // Pack Daily Mission document payload
        const newMissionData = {
            questId: quest.questId,
            userId: userId,
            date: todayStr,
            questType: quest.questType,
            state: "Finalized",
            clearLevel: clearStatus,
            completedMinutes: completedMinVal,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            targets: targetsObj,
            failureReason: failureReason,
            goldEarned: reward.gold,
            xpEarned: reward.xp
        };
        
        // Trigger Transaction Database Write
        await executeMissionTransaction(
            missionId,
            userId,
            quest.questId,
            reward.gold,
            reward.xp,
            levelInc,
            clearLevel !== "Missed",
            shieldDeduct,
            updatedQuestStats,
            newMissionData
        );
        
        // Reload global states and display success alert Toast
        await loadUserQuestsAndTodayLogs();
        
        let toastMsg = `Mission Logged! ${clearStatus} Clear.`;
        if (reward.xp > 0 || reward.gold > 0) {
            toastMsg += ` +${reward.xp} XP, +${reward.gold} Gold!`;
        }
        if (levelInc > 0) {
            toastMsg += " LEVEL UP! 🎉";
        }
        if (shieldDeduct) {
            toastMsg += " Streak Shield Utilized 🛡️";
        }
        
        showToast(toastMsg, "✨");
        
        if (onMissionLoggedCallback) {
            onMissionLoggedCallback();
        }
        
    } catch (err) {
        console.error("Daily Mission submission transaction failed:", err);
        if (err.message.includes("mission/already-finalized")) {
            alert("⚠️ Abort Check-In: A Daily Mission for this Quest has already been completed today!");
        } else {
            alert("Firestore Transaction Failed: Unable to finalize mission log.");
        }
        enableAllMissionActions();
    }
}

// 5. MISSION FAILURE FLOW & MODAL CONTROL
function triggerFailureFlow(quest) {
    const detailPanel = document.getElementById("failureReasonPanel");
    if (detailPanel) {
        detailPanel.classList.remove("hidden");
        // Scroll to panel
        detailPanel.scrollIntoView({ behavior: "smooth" });
    }
    
    const form = document.getElementById("failureReasonForm");
    if (!form) return;
    
    // Clear listeners
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    
    document.getElementById("btnCancelFailure").addEventListener("click", () => {
        detailPanel.classList.add("hidden");
    });
    
    newForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const reason = document.getElementById("failureReasonSelect").value;
        const note = document.getElementById("failureNote").value;
        
        finalizeMissionProcess(quest, "Missed", 0, {}, reason);
    });
}

// Helper control actions
function disableAllMissionActions() {
    const btns = document.querySelectorAll("#questDetailView button, #questDetailView input");
    btns.forEach(btn => btn.disabled = true);
}

function enableAllMissionActions() {
    const btns = document.querySelectorAll("#questDetailView button, #questDetailView input");
    btns.forEach(btn => btn.disabled = false);
}

function showToast(text, emoji = "✨") {
    const toast = document.getElementById("toast");
    const txt = document.getElementById("toastText");
    const icon = toast?.querySelector(".toast-icon");
    
    if (!toast || !txt) return;
    
    txt.innerText = text;
    if (icon) icon.innerText = emoji;
    
    toast.classList.remove("hidden");
    setTimeout(() => {
        toast.classList.add("hidden");
    }, 4500);
}
