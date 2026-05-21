/**
 * ==========================================================================
 * HabitQuest - Central SPA Conductor & Routing Hub (app.js)
 * ==========================================================================
 */

import { isMockMode, updateDocument, getDocument } from "./firebase-config.js";
import { 
    registerAuthStateListener, 
    loginWithGoogle, 
    loginAsAdmin, 
    logoutUser, 
    currentUserProfile 
} from "./auth.js";
import { 
    createQuest, 
    loadUserQuestsAndTodayLogs, 
    renderQuestBoard, 
    userQuests, 
    todayMissions,
    pauseQuestCampaign,
    archiveQuestCampaign,
    deleteQuestCampaign
} from "./quests.js";
import { 
    loadActiveMissionInterface, 
    registerMissionLoggedCallback 
} from "./missions.js";
import { calculateDifficulty, calculateLevel, SHOP_ITEMS, calculateReward } from "./systems.js";
import { loadAndRenderAdminPanel } from "./admin.js";

// Active Global State Variables
let currentActiveView = "authView";
let activeQuestDetailId = null;
let currentMultiTargetCount = 0; // Tracks checklist inputs count in form

// 1. SPA ROUTING VIEW CONTROLLER
function switchView(viewId) {
    const views = ["configErrorView", "authView", "dashboardView", "createQuestView", "questDetailView", "shopView", "bagView", "adminView"];
    views.forEach(v => {
        const el = document.getElementById(v);
        if (el) {
            if (v === viewId) {
                el.classList.remove("hidden");
            } else {
                el.classList.add("hidden");
            }
        }
    });
    currentActiveView = viewId;
    window.scrollTo(0, 0);
}

// ==========================================================================
// 2. BOOTSTRAP INITIALIZATION ON LOAD
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    setupThemeFromSystem();
    setupNavigationListeners();
    setupAuthListeners();
    setupFormListeners();
    setupDetailActionListeners();
    
    // Core callback connection when missions are finalized successfully
    registerMissionLoggedCallback(() => {
        // Redraw quest board and refresh profile stats
        refreshAppStatesAndDashboard();
    });
});

// Configure active theme from document body
function setupThemeFromSystem() {
    // Read local cache or default to default
    const activeTheme = localStorage.getItem("habitquest_applied_theme") || "default";
    document.body.className = `theme-${activeTheme}`;
}

// 3. WIRE AUTH SYSTEM BUTTONS
function setupAuthListeners() {
    const googleBtn = document.getElementById("googleLoginBtn");
    const adminForm = document.getElementById("adminLoginForm");
    const authModeNotice = document.getElementById("authModeNotice");
    
    if (googleBtn) {
        googleBtn.addEventListener("click", async () => {
            try {
                googleBtn.disabled = true;
                await loginWithGoogle();
            } catch (err) {
                console.error("Adventurer Google Login failed:", err);
                alert("Authentication Failed: Google popup was closed or network error occurred.");
                googleBtn.disabled = false;
            }
        });
    }
    
    if (adminForm) {
        adminForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const email = document.getElementById("adminEmail").value;
            const password = document.getElementById("adminPassword").value;
            const errorMsg = document.getElementById("adminErrorMsg");
            const submitBtn = document.getElementById("adminLoginBtn");
            
            try {
                if (errorMsg) errorMsg.classList.add("hidden");
                submitBtn.disabled = true;
                
                await loginAsAdmin(email, password);
            } catch (err) {
                console.error("Guild Master Login failed:", err);
                if (errorMsg) {
                    errorMsg.innerText = err.message.includes("wrong-password") || err.message.includes("user-not-found")
                        ? "⚠️ Access Denied: Invalid credentials."
                        : `⚠️ Error: ${err.message}`;
                    errorMsg.classList.remove("hidden");
                }
                submitBtn.disabled = false;
            }
        });
    }
    
    if (authModeNotice) {
        if (isMockMode) {
            authModeNotice.innerHTML = `⭐ Running in <strong>Local Mock Mode</strong>.<br>Admin bypass: <code>admin@habitquest.com</code> / <code>admin123</code>`;
        } else {
            authModeNotice.innerText = "⚡ Real Firebase Auth Mode Active.";
        }
    }
    
    // Core listener hook to redirect based on auth status
    registerAuthStateListener(async (userProfile) => {
        if (userProfile) {
            if (userProfile.role === "admin") {
                switchView("adminView");
                await loadAndRenderAdminPanel();
            } else {
                switchView("dashboardView");
                applyVisualTheme(userProfile.activeTheme || "default");
                await refreshAppStatesAndDashboard();
            }
        } else {
            switchView("authView");
            document.body.className = "theme-default";
            const googleBtn = document.getElementById("googleLoginBtn");
            const adminForm = document.getElementById("adminLoginForm");
            if (googleBtn) googleBtn.disabled = false;
            if (adminForm) {
                adminForm.reset();
                document.getElementById("adminLoginBtn").disabled = false;
            }
        }
    });
}

// 4. ROUTING AND NAVIGATION TAB LISTENERS
function setupNavigationListeners() {
    // Nav bar clicks inside dashboard
    document.getElementById("navDashboard").addEventListener("click", () => renderDashboardTab());
    document.getElementById("navShop").addEventListener("click", () => renderShopTab());
    document.getElementById("navBag").addEventListener("click", () => renderBagTab());
    
    // Quick back buttons
    document.getElementById("btnBackToDashboardFromCreate").addEventListener("click", () => renderDashboardTab());
    document.getElementById("btnBackToDashboardFromDetail").addEventListener("click", () => renderDashboardTab());
    
    // Nav from Shop
    document.getElementById("navDashboardFromShop").addEventListener("click", () => renderDashboardTab());
    document.getElementById("navShopFromShop").addEventListener("click", () => renderShopTab());
    document.getElementById("navBagFromShop").addEventListener("click", () => renderBagTab());
    document.getElementById("btnBackToDashboardFromShop").addEventListener("click", () => renderDashboardTab());
    
    // Nav from Bag
    document.getElementById("navDashboardFromBag").addEventListener("click", () => renderDashboardTab());
    document.getElementById("navShopFromBag").addEventListener("click", () => renderShopTab());
    document.getElementById("navBagFromBag").addEventListener("click", () => renderBagTab());
    document.getElementById("btnBackToDashboardFromBag").addEventListener("click", () => renderDashboardTab());
    
    // Create new Quest button triggers form loading
    document.getElementById("btnOpenCreateQuest").addEventListener("click", () => {
        switchView("createQuestView");
        resetCreateQuestForm();
    });
    
    // View archives drawer toggle
    const toggleArchiveBtn = document.getElementById("btnToggleArchive");
    if (toggleArchiveBtn) {
        toggleArchiveBtn.addEventListener("click", () => {
            const container = document.getElementById("archiveQuestsContainer");
            const icon = document.getElementById("archiveToggleIcon");
            if (container) {
                const hidden = container.classList.toggle("hidden");
                if (icon) icon.innerText = hidden ? "▼" : "▲";
            }
        });
    }
    
    // Logouts
    document.getElementById("navLogout").addEventListener("click", () => logoutUser());
    document.getElementById("adminLogoutBtn").addEventListener("click", () => logoutUser());
}

// ==========================================================================
// 5. USER PROFILE HEADERS & DASHBOARD TAB
// ==========================================================================
async function refreshAppStatesAndDashboard() {
    if (!currentUserProfile) return;
    
    // Reload data from database
    await loadUserQuestsAndTodayLogs();
    
    // Render profile stats header
    const profileSnap = await getDocument("users", currentUserProfile.uid);
    const profile = profileSnap.data();
    
    // Cache profile updates in state
    currentUserProfile.gold = profile.gold || 0;
    currentUserProfile.xp = profile.xp || 0;
    currentUserProfile.level = profile.level || 1;
    currentUserProfile.activeTitle = profile.activeTitle || "Rookie Adventurer";
    currentUserProfile.activeTheme = profile.activeTheme || "default";
    currentUserProfile.inventory = profile.inventory || {};
    
    document.getElementById("profileName").innerText = profile.name || "Adventurer";
    
    const titleBadge = document.getElementById("profileTitle");
    if (titleBadge) {
        titleBadge.innerText = profile.activeTitle || "Rookie Adventurer";
    }
    
    document.getElementById("profileLevel").innerText = profile.level || 1;
    document.getElementById("profileGold").innerText = `🪙 ${profile.gold || 0}`;
    
    const shieldsCount = profile.inventory?.streakShield || 0;
    document.getElementById("profileShields").innerText = `🛡️ ${shieldsCount}`;
    
    // XP Fill calculation
    const xp = profile.xp || 0;
    const currentXpBase = xp % 100;
    document.getElementById("profileXpFill").style.width = `${currentXpBase}%`;
    document.getElementById("profileXpText").innerText = `${currentXpBase} / 100 XP`;
    
    // Apply theme
    applyVisualTheme(profile.activeTheme || "default");
    
    // Render quest list board
    renderQuestBoard(openQuestDetailView);
}

function renderDashboardTab() {
    switchView("dashboardView");
    refreshAppStatesAndDashboard();
}

// Swap CSS theme classes on body
function applyVisualTheme(themeName) {
    const valid = ["default", "midnight", "forest"];
    const target = valid.includes(themeName) ? themeName : "default";
    document.body.className = `theme-${target}`;
    localStorage.setItem("habitquest_applied_theme", target);
}

// ==========================================================================
// 6. CREATE QUEST FORM LOGIC & LIVE ASSESSMENT
// ==========================================================================
function setupFormListeners() {
    const form = document.getElementById("createQuestForm");
    const qTypeSelect = document.getElementById("questType");
    const addSubtargetBtn = document.getElementById("btnAddMultiTarget");
    
    if (qTypeSelect) {
        qTypeSelect.addEventListener("change", (e) => {
            const type = e.target.value;
            const focusSection = document.getElementById("focusQuestFields");
            const multiSection = document.getElementById("multiMissionFields");
            
            if (type === "focus") {
                focusSection.classList.remove("hidden");
                multiSection.classList.add("hidden");
            } else if (type === "multi") {
                focusSection.classList.add("hidden");
                multiSection.classList.remove("hidden");
                // Bootstrap default subtargets
                if (currentMultiTargetCount === 0) {
                    addFormSubtargetRow("Target #1");
                    addFormSubtargetRow("Target #2");
                }
            } else {
                focusSection.classList.add("hidden");
                multiSection.classList.add("hidden");
            }
            
            triggerRealtimeAssessment();
        });
    }
    
    if (addSubtargetBtn) {
        addSubtargetBtn.addEventListener("click", () => {
            addFormSubtargetRow(`Target #${currentMultiTargetCount + 1}`);
            triggerRealtimeAssessment();
        });
    }
    
    // Live assessment triggers on any parameters modification
    const fields = ["questType", "challengeDays", "frequencyPerWeek", "minMinutes", "normalMinutes", "perfectMinutes"];
    fields.forEach(fid => {
        const el = document.getElementById(fid);
        if (el) {
            el.addEventListener("input", () => triggerRealtimeAssessment());
            el.addEventListener("change", () => triggerRealtimeAssessment());
        }
    });
    
    // Submit creation
    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const submitBtn = document.getElementById("btnSubmitQuest");
            submitBtn.disabled = true;
            
            const title = document.getElementById("questTitle").value.trim();
            const reason = document.getElementById("questReason").value.trim();
            const category = document.getElementById("questCategory").value;
            const type = document.getElementById("questType").value;
            const challengeDays = document.getElementById("challengeDays").value;
            const frequency = document.getElementById("frequencyPerWeek").value;
            
            if (!title || !reason) {
                alert("Quest Title and Reason motivation are required.");
                submitBtn.disabled = false;
                return;
            }
            
            // Collect dynamic parameters
            const extraParams = {
                minimumMinutes: 0,
                normalMinutes: 0,
                perfectMinutes: 0,
                dailyTargets: []
            };
            
            if (type === "focus") {
                const min = parseInt(document.getElementById("minMinutes").value) || 0;
                const norm = parseInt(document.getElementById("normalMinutes").value) || 0;
                const perf = parseInt(document.getElementById("perfectMinutes").value) || 0;
                
                if (norm < min || perf < norm) {
                    alert("⚠️ Input Error: Perfect minutes must be greater than Normal minutes, and Normal minutes must be greater than Minimum minutes!");
                    submitBtn.disabled = false;
                    return;
                }
                
                extraParams.minimumMinutes = min;
                extraParams.normalMinutes = norm;
                extraParams.perfectMinutes = perf;
                
            } else if (type === "multi") {
                const targetInputs = document.querySelectorAll(".form-subtarget-input");
                const targets = [];
                targetInputs.forEach((inp, idx) => {
                    const text = inp.value.trim();
                    if (text) {
                        targets.push({
                            id: `t_${idx}_` + Math.random().toString(36).substring(2, 6),
                            name: text
                        });
                    }
                });
                
                if (targets.length === 0) {
                    alert("⚠️ Multi Mission Quests require at least one daily target defined!");
                    submitBtn.disabled = false;
                    return;
                }
                
                extraParams.dailyTargets = targets;
            }
            
            try {
                const success = await createQuest(title, reason, category, type, challengeDays, frequency, extraParams);
                if (success) {
                    renderDashboardTab();
                }
            } catch (err) {
                console.error("Quest post submission failed:", err);
                alert("Error writing to database: Unable to post Quest.");
                submitBtn.disabled = false;
            }
        });
    }
}

function resetCreateQuestForm() {
    const form = document.getElementById("createQuestForm");
    if (!form) return;
    form.reset();
    
    document.getElementById("focusQuestFields").classList.add("hidden");
    document.getElementById("multiMissionFields").classList.add("hidden");
    document.getElementById("multiTargetsContainer").innerHTML = "";
    currentMultiTargetCount = 0;
    
    document.getElementById("btnSubmitQuest").disabled = false;
    triggerRealtimeAssessment();
}

function addFormSubtargetRow(placeholderText) {
    const container = document.getElementById("multiTargetsContainer");
    if (!container) return;
    
    currentMultiTargetCount++;
    
    const row = document.createElement("div");
    row.className = "target-input-row";
    row.innerHTML = `
        <input type="text" placeholder="${placeholderText}" class="form-control form-subtarget-input" required>
        <button type="button" class="btn btn-outline btn-sm btn-remove-subtarget">❌</button>
    `;
    
    row.querySelector(".btn-remove-subtarget").addEventListener("click", () => {
        row.remove();
        currentMultiTargetCount = Math.max(0, currentMultiTargetCount - 1);
        triggerRealtimeAssessment();
    });
    
    // Realtime assessment trigger on target input modification
    row.querySelector("input").addEventListener("input", () => triggerRealtimeAssessment());
    
    container.appendChild(row);
}

// Evaluates parameters automatically in form view
function triggerRealtimeAssessment() {
    const type = document.getElementById("questType").value;
    const challengeDays = document.getElementById("challengeDays").value;
    const frequency = document.getElementById("frequencyPerWeek").value;
    
    let effortVal = 1;
    if (type === "focus") {
        effortVal = parseInt(document.getElementById("normalMinutes").value) || 30;
    } else if (type === "multi") {
        effortVal = currentMultiTargetCount || 2;
    }
    
    const assessment = calculateDifficulty(type, challengeDays, frequency, effortVal);
    
    // Update labels in form
    document.getElementById("diffScoreDisplay").innerText = assessment.score;
    
    const badge = document.getElementById("diffLevelDisplay");
    if (badge) {
        badge.innerText = assessment.level;
        let diffClass = "badge-easy";
        if (assessment.level === "Medium") diffClass = "badge-medium";
        else if (assessment.level === "Hard") diffClass = "badge-hard";
        else if (assessment.level === "Extreme") diffClass = "badge-extreme";
        
        badge.className = `badge ${diffClass}`;
    }
    
    // Rewards preview using centralized calculation
    const reward = calculateReward(assessment.level, "Normal");
    
    document.getElementById("previewGold").innerText = reward.goldEarned;
    document.getElementById("previewXp").innerText = reward.xpEarned;
}

// ==========================================================================
// 7. QUEST CAMPAIGN DETAILED VIEW RENDER
// ==========================================================================
async function openQuestDetailView(questId) {
    const quest = userQuests.find(q => q.questId === questId);
    if (!quest) return;
    
    activeQuestDetailId = questId;
    switchView("questDetailView");
    
    // Render Detail Metrics
    document.getElementById("detailCategoryBadge").innerText = quest.category;
    document.getElementById("detailQuestTitle").innerText = quest.title;
    document.getElementById("detailQuestReason").innerText = `"${quest.reason}"`;
    
    // Difficulty Level Badge color
    const dBadge = document.getElementById("detailDifficultyBadge");
    if (dBadge) {
        dBadge.innerText = quest.difficultyLevel;
        let diffClass = "badge-easy";
        if (quest.difficultyLevel === "Medium") diffClass = "badge-medium";
        else if (quest.difficultyLevel === "Hard") diffClass = "badge-hard";
        else if (quest.difficultyLevel === "Extreme") diffClass = "badge-extreme";
        dBadge.className = `badge ${diffClass}`;
    }
    
    // Status metrics lists
    document.getElementById("detailCurrentChain").innerText = `${quest.currentChain} Days`;
    document.getElementById("detailBestChain").innerText = `${quest.bestChain} Days`;
    document.getElementById("detailSuccessfulDays").innerText = `${quest.successfulDays} Days`;
    document.getElementById("detailMissedDays").innerText = `${quest.missedDays} Days`;
    
    // Consistency progress metrics
    const metrics = computeQuestMetrics(quest);
    document.getElementById("detailProgressFill").style.width = `${metrics.questProgress}%`;
    document.getElementById("detailProgressText").innerText = `${quest.successfulDays} / ${quest.challengeDays} Successful Days (${metrics.questProgress}%)`;
    
    document.getElementById("detailCompletionRate").innerText = `${metrics.completionRate}%`;
    
    const hBadge = document.getElementById("detailHealthStatus");
    if (hBadge) {
        hBadge.innerText = metrics.health;
        let healthClass = "badge-easy"; // Green for strong
        if (metrics.health === "Stable") healthClass = "badge-primary";
        else if (metrics.health === "At Risk") healthClass = "badge-medium";
        else if (metrics.health === "Critical") healthClass = "badge-hard";
        
        hBadge.className = `badge ${healthClass}`;
    }
    
    // Switch action pause state text
    const pauseBtn = document.getElementById("btnPauseQuest");
    if (pauseBtn) {
        pauseBtn.innerText = quest.status === "Paused" ? "▶ Resume Quest Campaign" : "⏸ Pause Quest Campaign";
    }
    
    // Hide Failure Reason form initially
    const failPanel = document.getElementById("failureReasonPanel");
    if (failPanel) failPanel.classList.add("hidden");
    const failForm = document.getElementById("failureReasonForm");
    if (failForm) failForm.reset();
    
    // Calculate and populate the Sidebar Campaign Reward Matrix previews
    const rewardMin = calculateReward(quest.difficultyLevel, "Minimum");
    const rewardNorm = calculateReward(quest.difficultyLevel, "Normal");
    const rewardPerf = calculateReward(quest.difficultyLevel, "Perfect");
    
    const minGoldEl = document.getElementById("detailRewardMinGold");
    const minXpEl = document.getElementById("detailRewardMinXp");
    const normGoldEl = document.getElementById("detailRewardNormGold");
    const normXpEl = document.getElementById("detailRewardNormXp");
    const perfGoldEl = document.getElementById("detailRewardPerfGold");
    const perfXpEl = document.getElementById("detailRewardPerfXp");
    
    if (minGoldEl) minGoldEl.innerText = `🪙 +${rewardMin.goldEarned} Gold`;
    if (minXpEl) minXpEl.innerText = `✨ +${rewardMin.xpEarned} XP`;
    if (normGoldEl) normGoldEl.innerText = `🪙 +${rewardNorm.goldEarned} Gold`;
    if (normXpEl) normXpEl.innerText = `✨ +${rewardNorm.xpEarned} XP`;
    if (perfGoldEl) perfGoldEl.innerText = `🪙 +${rewardPerf.goldEarned} Gold`;
    if (perfXpEl) perfXpEl.innerText = `✨ +${rewardPerf.xpEarned} XP`;
    
    // Renders active daily mission controls interface
    const missionContainer = document.getElementById("missionInterfaceContainer");
    await loadActiveMissionInterface(missionContainer, quest, currentUserProfile);
}

// Compute quest metrics locally
function computeQuestMetrics(quest) {
    const start = new Date(quest.startDate);
    const today = new Date();
    start.setHours(0,0,0,0);
    today.setHours(0,0,0,0);
    
    const diffTime = Math.abs(today - start);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
    const elapsedDays = Math.min(diffDays, quest.challengeDays);
    
    const questProgress = Math.round((quest.successfulDays / quest.challengeDays) * 100);
    const completionRate = elapsedDays > 0 
        ? Math.round((quest.successfulDays / elapsedDays) * 100)
        : 100;
        
    const health = metricsHealthEvaluator(completionRate);
    
    return {
        questProgress,
        completionRate,
        health
    };
}

function metricsHealthEvaluator(rate) {
    if (rate >= 85) return "Strong";
    if (rate >= 70) return "Stable";
    if (rate >= 50) return "At Risk";
    return "Critical";
}

// 8. METRICS PAUSE, ARCHIVE, DELETE ACTIONS
function setupDetailActionListeners() {
    document.getElementById("btnPauseQuest").addEventListener("click", async () => {
        if (!activeQuestDetailId) return;
        const quest = userQuests.find(q => q.questId === activeQuestDetailId);
        if (!quest) return;
        
        await pauseQuestCampaign(activeQuestDetailId, quest.status);
        openQuestDetailView(activeQuestDetailId); // Refresh details view
        alert(`Quest Campaign status updated: ${quest.status === "Paused" ? "Resumed Active" : "Paused"}.`);
    });
    
    document.getElementById("btnArchiveQuest").addEventListener("click", async () => {
        if (!activeQuestDetailId) return;
        const confirmArc = confirm("Are you sure you want to Archive this quest? Archived quests can no longer log Daily Missions.");
        if (!confirmArc) return;
        
        await archiveQuestCampaign(activeQuestDetailId);
        renderDashboardTab();
    });
    
    document.getElementById("btnDeleteQuest").addEventListener("click", async () => {
        if (!activeQuestDetailId) return;
        const confirmDel = confirm("⚠️ Danger: Are you sure you want to delete this quest from the active board? (This soft-archives the history logs).");
        if (!confirmDel) return;
        
        await deleteQuestCampaign(activeQuestDetailId);
        renderDashboardTab();
    });
}

// ==========================================================================
// 9. SHOP RENDERING & BALANCE DEdUCTION
// ==========================================================================
function renderShopTab() {
    switchView("shopView");
    
    const goldDisplay = document.getElementById("shopGoldDisplay");
    if (goldDisplay) {
        goldDisplay.innerText = `🪙 ${currentUserProfile.gold}`;
    }
    
    const container = document.getElementById("shopItemsContainer");
    if (!container) return;
    
    container.innerHTML = "";
    
    SHOP_ITEMS.forEach(item => {
        // Evaluate owned state from user inventory profile
        let isOwned = false;
        let ctaText = "Buy Item";
        let ctaDisabled = false;
        
        if (item.type !== "utility") {
            // Title and themes cannot be bought twice
            isOwned = !!currentUserProfile.inventory?.[item.id];
            if (isOwned) {
                ctaText = "✓ Owned";
                ctaDisabled = true;
            }
        }
        
        // Disable purchase if user gold is insufficient
        if (!isOwned && currentUserProfile.gold < item.price) {
            ctaDisabled = true;
        }
        
        const card = document.createElement("div");
        card.className = "card neo-card shop-item-card";
        
        card.innerHTML = `
            <div>
                <span class="shop-item-type text-primary">${item.type}</span>
                <h4 class="shop-item-title">${item.name}</h4>
                <p class="shop-item-desc secondary-text">${item.description}</p>
            </div>
            
            <div class="shop-item-footer">
                <span class="shop-item-price">🪙 ${item.price} Gold</span>
                <button class="btn btn-sm btn-primary btn-shop-buy" data-id="${item.id}" ${ctaDisabled ? "disabled" : ""}>
                    ${ctaText}
                </button>
            </div>
        `;
        
        // Purchase Listener trigger
        if (!isOwned && currentUserProfile.gold >= item.price) {
            card.querySelector(".btn-shop-buy").addEventListener("click", () => purchaseShopItem(item));
        }
        
        container.appendChild(card);
    });
}

async function purchaseShopItem(item) {
    if (!currentUserProfile) return;
    
    const confirmBuy = confirm(`Purchase "${item.name}" for 🪙 ${item.price} Gold?`);
    if (!confirmBuy) return;
    
    const uid = currentUserProfile.uid;
    const currentGold = currentUserProfile.gold;
    const newGold = Math.max(0, currentGold - item.price);
    
    // Update inventory bundle
    const inv = { ...currentUserProfile.inventory };
    if (item.type === "utility") {
        // Streak Shield counter increment
        const currentCount = inv[item.id] || 0;
        inv[item.id] = currentCount + 1;
    } else {
        // Lock titles and themes
        inv[item.id] = true;
    }
    
    try {
        // Save updates to Firestore users collection
        const payload = {
            gold: newGold,
            inventory: inv
        };
        
        await updateDocument("users", uid, payload);
        
        currentUserProfile.gold = newGold;
        currentUserProfile.inventory = inv;
        
        // Refresh app and re-draw Shop view
        refreshAppStatesAndDashboard();
        renderShopTab();
        
        alert(`🎉 Purchase Completed! Unlocked: "${item.name}".`);
    } catch (err) {
        console.error("Shop purchase transaction failed:", err);
        alert("Database Write Error: Unable to complete shop transaction.");
    }
}

// ==========================================================================
// 10. INVENTORY BAG RENDERING & EQUIP CONTROLS
// ==========================================================================
function renderBagTab() {
    switchView("bagView");
    
    const shieldsCount = currentUserProfile.inventory?.streakShield || 0;
    document.getElementById("bagShieldCount").innerText = `🛡️ ${shieldsCount}`;
    
    const titlesContainer = document.getElementById("inventoryTitlesContainer");
    const themesContainer = document.getElementById("inventoryThemesContainer");
    
    if (titlesContainer) titlesContainer.innerHTML = "";
    if (themesContainer) themesContainer.innerHTML = "";
    
    // Render Owned Titles list
    const titleItems = SHOP_ITEMS.filter(item => item.type === "title");
    // Standard Rookie Adventurer is unlocked by default
    const allTitles = [
        { id: "titleRookie", name: "Rookie Adventurer" },
        ...titleItems.map(t => ({ id: t.id, name: t.name.replace(" Title", "") }))
    ];
    
    let activeTitleOwned = false;
    allTitles.forEach(title => {
        // Cek if owned (Rookie is always unlocked)
        const isOwned = title.id === "titleRookie" ? true : !!currentUserProfile.inventory?.[title.id];
        if (isOwned) {
            const isActive = currentUserProfile.activeTitle === title.name;
            activeTitleOwned = true;
            
            const div = document.createElement("div");
            div.className = "inventory-item";
            div.innerHTML = `
                <span>🏆 ${title.name}</span>
                ${isActive 
                    ? `<span class="active-item-badge">Active</span>` 
                    : `<button class="btn btn-sm btn-outline btn-equip-title font-bold" data-name="${title.name}">Equip</button>`
                }
            `;
            
            if (!isActive) {
                div.querySelector(".btn-equip-title").addEventListener("click", () => equipTitle(title.name));
            }
            
            titlesContainer.appendChild(div);
        }
    });
    
    // Render Owned Themes list
    const themeItems = SHOP_ITEMS.filter(item => item.type === "theme");
    const allThemes = [
        { id: "default", name: "Default Theme", class: "default" },
        ...themeItems.map(t => ({ id: t.id, name: t.name, class: t.id.replace("theme", "").toLowerCase() }))
    ];
    
    allThemes.forEach(theme => {
        const isOwned = theme.id === "default" ? true : !!currentUserProfile.inventory?.[theme.id];
        if (isOwned) {
            const isActive = currentUserProfile.activeTheme === theme.class;
            
            const div = document.createElement("div");
            div.className = "inventory-item";
            div.innerHTML = `
                <span>🎨 ${theme.name}</span>
                ${isActive 
                    ? `<span class="active-item-badge">Active</span>` 
                    : `<button class="btn btn-sm btn-outline btn-apply-theme font-bold" data-class="${theme.class}">Apply</button>`
                }
            `;
            
            if (!isActive) {
                div.querySelector(".btn-apply-theme").addEventListener("click", () => applyTheme(theme.class));
            }
            
            themesContainer.appendChild(div);
        }
    });
}

async function equipTitle(titleName) {
    if (!currentUserProfile) return;
    
    try {
        const uid = currentUserProfile.uid;
        await updateDocument("users", uid, { activeTitle: titleName });
        currentUserProfile.activeTitle = titleName;
        
        refreshAppStatesAndDashboard();
        renderBagTab();
        alert(`Title Equipped: "${titleName}".`);
    } catch (err) {
        console.error("Equipping title failed:", err);
        alert("Firestore Update Failed: Unable to equip title.");
    }
}

async function applyTheme(themeClass) {
    if (!currentUserProfile) return;
    
    try {
        const uid = currentUserProfile.uid;
        await updateDocument("users", uid, { activeTheme: themeClass });
        currentUserProfile.activeTheme = themeClass;
        
        applyVisualTheme(themeClass);
        refreshAppStatesAndDashboard();
        renderBagTab();
        alert(`Theme Applied: Swapped to ${themeClass.toUpperCase()} style.`);
    } catch (err) {
        console.error("Applying theme failed:", err);
        alert("Firestore Update Failed: Unable to apply theme.");
    }
}
