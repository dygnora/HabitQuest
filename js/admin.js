/**
 * ==========================================================================
 * HabitQuest - Guild Master Administrative Monitoring Panel
 * ==========================================================================
 */

import { queryDocuments } from "./firebase-config.js";
import { getLocalTodayString } from "./systems.js";
import { syncPublicProfile } from "./leaderboard.js";

// 1. COMPUTE AND RENDER GUILD MASTER PANEL
export async function loadAndRenderAdminPanel() {
    // A. Show Loading Placeholder
    setLoadingState();
    
    // Bind Event Listeners defensively (only once)
    setupAdminEventListeners();
    
    try {
        const todayStr = getLocalTodayString();
        const period = document.getElementById("adminPeriodFilter")?.value || "all";
        
        // Hide error banner
        const errorBanner = document.getElementById("adminDashboardError");
        if (errorBanner) {
            errorBanner.classList.add("hidden");
            errorBanner.innerHTML = "";
        }
        
        // B. FETCH ALL RELEVANT DATA FROM DB
        // Firestore rules grant complete read access to users with role="admin"
        const usersSnap = await queryDocuments("users");
        const questsSnap = await queryDocuments("quests");
        const missionsSnap = await queryDocuments("dailyMissions");
        
        // Store records
        const allUsers = usersSnap.docs.map(d => ({
            id: d.id,
            uid: d.id,
            ...d.data()
        }));
        const allQuests = questsSnap.docs.map(d => d.data());
        const allMissions = missionsSnap.docs.map(d => d.data());
        
        // Filter users to only normal adventurers
        const adventurers = allUsers.filter(u => u.role === "user");
        
        // Auto-sync public profiles for all adventurers in the background
        adventurers.forEach(u => {
            syncPublicProfile(u.uid).catch(err => {
                console.error(`Auto-sync failed for adventurer ${u.uid}:`, err);
            });
        });
        
        // C. APPLY PERIOD FILTER TO COLLECTIONS
        const filteredMissions = allMissions.filter(m => isDateInPeriod(m.date, period, todayStr));
        
        const nonArchivedQuests = allQuests.filter(q => q.status !== "Archived" && q.status !== "Abandoned");
        const questsForPeriod = nonArchivedQuests.filter(q => isDateInPeriod(q.startDate, period, todayStr));
        
        // E. CALCULATE STATS
        const totalUsers = adventurers.length;
        const totalQuests = nonArchivedQuests.length;
        const activeQuests = nonArchivedQuests.filter(q => q.status === "Active").length;
        const completedQuests = nonArchivedQuests.filter(q => q.status === "Completed").length;
        
        // Missions count for selected period
        const missionsToday = filteredMissions.length;
        
        // Logged Failures count for selected period
        let loggedFailures = 0;
        filteredMissions.forEach(m => {
            if (m.failureReason) {
                loggedFailures++;
            }
        });
        
        // Calculate average completion rate across period non-archived quests
        let sumRate = 0;
        let countedQuests = 0;
        let atRiskQuests = 0;
        
        questsForPeriod.forEach(quest => {
            const rate = getQuestCompletionRate(quest);
            sumRate += rate;
            countedQuests++;
            
            if (rate < 50) {
                atRiskQuests++;
            }
        });
        
        const avgCompletionRate = countedQuests > 0 
            ? Math.round(sumRate / countedQuests)
            : 0;
            
        // Render Top Metrics Boxes
        safeSetText("adminTotalUsers", totalUsers);
        safeSetText("adminActiveQuests", activeQuests);
        safeSetText("adminTotalQuests", totalQuests);
        safeSetText("adminCompletedQuests", completedQuests);
        safeSetText("adminMissionsToday", missionsToday);
        safeSetText("adminAvgCompletionRate", `${avgCompletionRate}%`);
        safeSetText("adminLoggedFailures", loggedFailures);
        safeSetText("adminAtRiskQuests", atRiskQuests);
        
        // F. COMPUTE FAILURE REASON DISTRIBUTIONS
        const failureCounts = {
            Forgot: 0,
            Busy: 0,
            "Low Energy": 0,
            "Target Too Hard": 0,
            "No Motivation": 0,
            "Environment Problem": 0,
            Other: 0
        };
        
        let totalFailuresLogged = 0;
        filteredMissions.forEach(m => {
            if (m.failureReason && failureCounts[m.failureReason] !== undefined) {
                failureCounts[m.failureReason]++;
                totalFailuresLogged++;
            }
        });
        
        safeSetText("adminFailureTotal", totalFailuresLogged);
        renderFailureReasonChart(failureCounts, totalFailuresLogged);
        
        // Generate and display recommendation based on most common reason
        generateAdminSuggestion(failureCounts);
        
        // G. EXECUTIVE INSIGHT AUTOMATIC COMPILATION
        generateExecutiveInsight(failureCounts, avgCompletionRate, activeQuests, totalUsers);
        
        // H. QUEST STATUS BREAKDOWN
        renderQuestStatusBreakdown(allQuests);
        
        // I. LEADERBOARD STANDINGS
        // Accumulate statistics per user across non-archived quests
        const userStatsMap = {};
        adventurers.forEach(u => {
            userStatsMap[u.uid] = {
                name: u.name || "Adventurer",
                level: u.level || 1,
                xp: u.xp || 0,
                successfulDays: 0,
                activeQuests: 0
            };
        });
        
        nonArchivedQuests.forEach(q => {
            if (userStatsMap[q.userId]) {
                userStatsMap[q.userId].successfulDays += (q.successfulDays || 0);
            }
        });
        
        // Count active quests per adventurer
        allQuests.forEach(q => {
            if (userStatsMap[q.userId] && q.status === "Active") {
                userStatsMap[q.userId].activeQuests++;
            }
        });
        
        // Sort by successfulDays -> XP -> Level
        const sortedLeaderboard = Object.values(userStatsMap).sort((a, b) => {
            if (b.successfulDays !== a.successfulDays) return b.successfulDays - a.successfulDays;
            if (b.xp !== a.xp) return b.xp - a.xp;
            return b.level - a.level;
        });
        
        renderLeaderboardTable(sortedLeaderboard.slice(0, 10));
        
        // J. ADVENTURER HEALTH TABLE
        renderAdventurerHealthTable(adventurers, allQuests);
        
        // K. RECENT MISSION ACTIVITY
        renderRecentActivity(filteredMissions, allUsers, allQuests);
        
        // L. SET LAST UPDATED TIME
        safeSetText("adminLastUpdated", `Last updated: ${getFormattedDateTime()}`);
        
    } catch (err) {
        console.error("Guild Master Command Center loader failed:", err);
        setErrorState(err);
    }
}

// 2. DEFENSIVE EVENT LISTENERS BINDING
function setupAdminEventListeners() {
    const refreshBtn = document.getElementById("adminRefreshBtn");
    if (refreshBtn && !refreshBtn.dataset.listenerBound) {
        refreshBtn.addEventListener("click", () => {
            loadAndRenderAdminPanel();
        });
        refreshBtn.dataset.listenerBound = "true";
    }

    const periodFilter = document.getElementById("adminPeriodFilter");
    if (periodFilter && !periodFilter.dataset.listenerBound) {
        periodFilter.addEventListener("change", () => {
            loadAndRenderAdminPanel();
        });
        periodFilter.dataset.listenerBound = "true";
    }
}

// 3. DATE FILTER HELPER
function isDateInPeriod(dateStr, period, todayStr) {
    if (period === "all" || !dateStr) return true;
    if (period === "today") return dateStr === todayStr;
    
    const today = new Date(todayStr);
    const target = new Date(dateStr);
    if (isNaN(target.getTime())) return true;
    
    const diffTime = today - target;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (period === "7d") return diffDays >= 0 && diffDays < 7;
    if (period === "30d") return diffDays >= 0 && diffDays < 30;
    return true;
}

// 4. QUEST COMPLETION RATE FORMULA
function getQuestCompletionRate(quest) {
    const successfulDays = quest.successfulDays || 0;
    const missedDays = quest.missedDays || 0;
    const totalDays = successfulDays + missedDays;
    
    if (totalDays > 0) {
        return (successfulDays / totalDays) * 100;
    }
    
    if (quest.startDate) {
        const start = new Date(quest.startDate);
        const today = new Date();
        start.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        const diffTime = Math.abs(today - start);
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
        const elapsed = Math.min(diffDays, quest.challengeDays || 14);
        if (elapsed > 0) {
            return (successfulDays / elapsed) * 100;
        }
    }
    return 0;
}

// 5. HELPER TO FORMAT TIME
function getFormattedDateTime() {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric"
    });
    const timeStr = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    });
    return `${dateStr}, ${timeStr}`;
}

// 6. HELPER FOR ENGAGEMENT STATUS BADGES
function getEngagementStatus(rate) {
    if (rate >= 80) return { label: "Strong", class: "status-strong" };
    if (rate >= 60) return { label: "Stable", class: "status-stable" };
    if (rate >= 40) return { label: "At Risk", class: "status-risk" };
    return { label: "Critical", class: "status-critical" };
}

// 7. SAFE TEXT INJECTOR
function safeSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

// 8. RENDER THE FAILURE BAR CHARTS
function renderFailureReasonChart(failureCounts, total) {
    const container = document.getElementById("adminFailureReasonDistribution");
    if (!container) return;
    
    container.innerHTML = "";
    
    if (total === 0) {
        container.innerHTML = `<p class="secondary-text italic text-center py-md" style="padding: 20px 0;">No daily mission failures have been logged in the system yet.</p>`;
        return;
    }
    
    const sorted = Object.entries(failureCounts).sort((a, b) => b[1] - a[1]);
    
    sorted.forEach(([reason, count]) => {
        const rate = total > 0 ? Math.round((count / total) * 100) : 0;
        
        const block = document.createElement("div");
        block.className = "failure-metric-bar";
        block.style.marginBottom = "12px";
        
        block.innerHTML = `
            <div class="flex justify-between font-bold text-xs" style="margin-bottom: 4px;">
                <span>⚠️ ${reason}</span>
                <span>${count} Logs (${rate}%)</span>
            </div>
            <div class="failure-bar-bg" style="width: 100%; height: 10px; background-color: var(--accent-tint); border: 2px solid var(--border); border-radius: var(--border-radius-sm); overflow: hidden;">
                <div class="failure-bar-fill" style="width: ${rate}%; height: 100%; background-color: var(--danger);"></div>
            </div>
        `;
        
        container.appendChild(block);
    });
}

// 9. GENERATE RECOMMENDATIONS BASED ON METRICS
function generateAdminSuggestion(counts) {
    const textEl = document.getElementById("adminInsightSuggestion");
    if (!textEl) return;
    
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const topReason = sorted[0]?.[0];
    const topCount = sorted[0]?.[1] || 0;
    
    if (topCount === 0) {
        textEl.innerText = "Discipline is high across the Guild! No major failure aggregates detected. Encourage adventurers to post more campaigns.";
        return;
    }
    
    let advice = "";
    if (topReason === "Forgot") {
        advice = "Advising Guild members to place visible quest cards at their desks. Setting up a morning habit triggers sequence is highly recommended.";
    } else if (topReason === "Busy") {
        advice = "Adventurers are struggling with schedule overloads. Suggest posting quests with lower Normal/Perfect stopwatch goals or fewer Multi Checklist sub-targets.";
    } else if (topReason === "Low Energy") {
        advice = "Energy drain is stopping daily missions. Recommend completing quests early in the morning when willpower is full, or decreasing the challenge duration.";
    } else if (topReason === "Target Too Hard") {
        advice = "Quest parameters are set too high! Suggest members to lower their Minimum/Normal limits in their configuration details. Consistency beats intensity.";
    } else if (topReason === "No Motivation") {
        advice = "Willpower deficiency detected. Advise members to connect their active quests directly with Shop purchases like visual Midnight/Forest themes.";
    } else if (topReason === "Environment Problem") {
        advice = "Atmosphere blocks focus. Suggest members declare a designated 'Discipline Zone' free of phones and notifications prior to running Focus stopwatches.";
    } else {
        advice = "Standard suggestion: Advise adventurers to lower quest weekly frequencies (e.g. from Everyday to Light Training) to avoid burn out.";
    }
    
    textEl.innerHTML = `
        Most common failure reason: <strong>${topReason}</strong> (${topCount} occurrences).<br>
        <strong>Guild Master Recommendation:</strong> ${advice}
    `;
}

// 10. GENERATE EXECUTIVE INSIGHT
function generateExecutiveInsight(failureCounts, avgCompletionRate, activeQuestsCount, totalUsers) {
    const el = document.getElementById("adminExecutiveInsight");
    if (!el) return;
    
    const sortedFailures = Object.entries(failureCounts).sort((a, b) => b[1] - a[1]);
    const topReason = sortedFailures[0]?.[0];
    const topCount = sortedFailures[0]?.[1] || 0;
    
    let insightText = "System consistency is stable. Keep encouraging daily check-ins.";
    let adviceClass = "badge-easy";
    
    if (topReason === "Busy" && topCount > 0) {
        insightText = "Most failures come from schedule overload. Recommend lowering quest frequency or duration.";
        adviceClass = "badge-hard";
    } else if (avgCompletionRate < 50 && avgCompletionRate > 0) {
        insightText = "Average completion is weak. Users may be creating quests that are too ambitious.";
        adviceClass = "badge-medium";
    } else if (totalUsers > 0 && (activeQuestsCount / totalUsers) > 5) {
        insightText = "Some users may be overtracking. Encourage focus on fewer habits.";
        adviceClass = "badge-medium";
    }
    
    el.innerHTML = `
        <h4 class="card-side-title" style="margin-bottom: 8px; font-family: 'Space Grotesk', sans-serif;">📊 Executive Consistency Recommendation</h4>
        <div class="flex align-center gap-sm">
            <span class="badge ${adviceClass}">Guild Insight</span>
            <p class="font-bold text-md" style="margin: 0;">${insightText}</p>
        </div>
    `;
}

// 11. RENDER QUEST STATUS BREAKDOWN
function renderQuestStatusBreakdown(allQuests) {
    const container = document.getElementById("adminQuestStatusBreakdown");
    if (!container) return;
    
    const active = allQuests.filter(q => q.status === "Active").length;
    const paused = allQuests.filter(q => q.status === "Paused").length;
    const completed = allQuests.filter(q => q.status === "Completed").length;
    const archived = allQuests.filter(q => q.status === "Archived").length;
    const abandoned = allQuests.filter(q => q.status === "Abandoned").length;
    
    container.innerHTML = `
        <div class="quest-status-grid">
            <div class="quest-status-box">
                <span class="metric-label" style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; opacity: 0.8;">Active</span>
                <span class="status-count text-primary">${active}</span>
            </div>
            <div class="quest-status-box">
                <span class="metric-label" style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; opacity: 0.8;">Paused</span>
                <span class="status-count text-gold">${paused}</span>
            </div>
            <div class="quest-status-box">
                <span class="metric-label" style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; opacity: 0.8;">Completed</span>
                <span class="status-count text-success">${completed}</span>
            </div>
            <div class="quest-status-box">
                <span class="metric-label" style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; opacity: 0.8;">Archived</span>
                <span class="status-count secondary-text">${archived}</span>
            </div>
            <div class="quest-status-box" style="grid-column: span 2;">
                <span class="metric-label" style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; opacity: 0.8;">Abandoned</span>
                <span class="status-count text-danger">${abandoned}</span>
            </div>
        </div>
    `;
}

// 12. RENDER STANDINGS LEADERBOARD TABLE
function renderLeaderboardTable(standings) {
    const tbody = document.getElementById("adminLeaderboardBody");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    
    if (standings.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center secondary-text italic">No standings data available.</td>
            </tr>
        `;
        return;
    }
    
    standings.forEach((user, idx) => {
        const row = document.createElement("tr");
        
        let medal = `#${idx + 1}`;
        if (idx === 0) medal = "🥇 1st";
        else if (idx === 1) medal = "🥈 2nd";
        else if (idx === 2) medal = "🥉 3rd";
        
        row.innerHTML = `
            <td class="font-bold">${medal}</td>
            <td class="font-bold">${user.name}</td>
            <td><span class="badge badge-outline">Lv. ${user.level}</span></td>
            <td><span class="text-primary font-bold">✨ ${user.xp} XP</span></td>
            <td class="font-bold text-success">${user.successfulDays} Days</td>
            <td class="font-bold">${user.activeQuests} Quests</td>
        `;
        tbody.appendChild(row);
    });
}

// 13. RENDER ADVENTURER HEALTH TABLE
function renderAdventurerHealthTable(adventurers, allQuests) {
    const tbody = document.getElementById("adminUserHealthBody");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    
    if (adventurers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center secondary-text italic">No adventurer health data.</td>
            </tr>
        `;
        return;
    }
    
    adventurers.forEach(u => {
        const userQuests = allQuests.filter(q => q.userId === u.uid);
        const activeQuests = userQuests.filter(q => q.status === "Active").length;
        const successfulDays = userQuests.reduce((sum, q) => sum + (q.successfulDays || 0), 0);
        const missedDays = userQuests.reduce((sum, q) => sum + (q.missedDays || 0), 0);
        
        const totalDays = successfulDays + missedDays;
        const completionRate = Math.round((successfulDays / Math.max(totalDays, 1)) * 100);
        const status = getEngagementStatus(completionRate);
        
        const row = document.createElement("tr");
        row.innerHTML = `
            <td class="font-bold">${u.name || "Adventurer"}</td>
            <td><span class="badge badge-outline">Lv. ${u.level || 1}</span></td>
            <td class="font-bold">${activeQuests} Quests</td>
            <td class="font-bold text-success">${successfulDays} Days</td>
            <td class="font-bold text-danger">${missedDays} Days</td>
            <td class="font-bold text-primary">${completionRate}%</td>
            <td><span class="status-pill ${status.class}">${status.label}</span></td>
        `;
        tbody.appendChild(row);
    });
}

// 14. RENDER RECENT MISSION ACTIVITY
function renderRecentActivity(missions, users, quests) {
    const tbody = document.getElementById("adminRecentActivityBody");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    
    if (missions.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center secondary-text italic">No recent mission activities in this period.</td>
            </tr>
        `;
        return;
    }
    
    const sorted = [...missions].sort((a, b) => {
        const timeA = new Date(a.finishedAt || a.startedAt || a.date).getTime();
        const timeB = new Date(b.finishedAt || b.startedAt || b.date).getTime();
        return timeB - timeA;
    });
    
    const recent = sorted.slice(0, 10);
    
    recent.forEach(m => {
        const user = users.find(u => u.uid === m.userId);
        const userName = user ? (user.name || "Adventurer") : "Adventurer";
        
        const quest = quests.find(q => q.questId === m.questId);
        const questTitle = quest ? (quest.title || "Unknown Quest") : "Unknown Quest";
        
        let rewardText = "-";
        if (m.clearLevel !== "Missed" && m.clearLevel !== "Shielded Missed") {
            rewardText = `🪙 +${m.goldEarned || 0} / ✨ +${m.xpEarned || 0}`;
        } else {
            rewardText = `🪙 +0 / ✨ +0`;
        }
        
        const failureText = m.failureReason ? `⚠️ ${m.failureReason}` : "-";
        
        let clearBadgeClass = "badge-outline";
        if (m.clearLevel) {
            const cleanTier = String(m.clearLevel).replace(/\s+/g, '-').toLowerCase();
            if (cleanTier.includes("perfect")) clearBadgeClass = "badge-perfect";
            else if (cleanTier.includes("normal")) clearBadgeClass = "badge-medium";
            else if (cleanTier.includes("min")) clearBadgeClass = "badge-minimum";
            else if (cleanTier.includes("missed")) clearBadgeClass = "badge-missed";
            else if (cleanTier.includes("shielded")) clearBadgeClass = "badge-shielded-missed";
        }
        
        const row = document.createElement("tr");
        row.innerHTML = `
            <td style="white-space: nowrap;">${m.date || "-"}</td>
            <td class="font-bold">${userName}</td>
            <td class="font-bold">${questTitle}</td>
            <td><span class="badge ${clearBadgeClass}">${m.clearLevel || "Finalized"}</span></td>
            <td class="font-bold text-success">${rewardText}</td>
            <td class="font-bold text-danger">${failureText}</td>
        `;
        tbody.appendChild(row);
    });
}

// 15. LOADING STATE WRAPPER
function setLoadingState() {
    safeSetText("adminTotalUsers", "...");
    safeSetText("adminActiveQuests", "...");
    safeSetText("adminTotalQuests", "...");
    safeSetText("adminCompletedQuests", "...");
    safeSetText("adminMissionsToday", "...");
    safeSetText("adminAvgCompletionRate", "...%");
    safeSetText("adminLoggedFailures", "...");
    safeSetText("adminAtRiskQuests", "...");
    
    const execInsight = document.getElementById("adminExecutiveInsight");
    if (execInsight) execInsight.innerHTML = `<p class="secondary-text italic text-center">Loading Executive Insights...</p>`;
    
    const failureReason = document.getElementById("adminFailureReasonDistribution");
    if (failureReason) failureReason.innerHTML = `<p class="secondary-text italic text-center">Loading failures...</p>`;
    
    safeSetText("adminInsightSuggestion", "Analyzing aggregates to compile recommendations...");
    safeSetText("adminFailureTotal", "...");
    
    const activityBody = document.getElementById("adminRecentActivityBody");
    if (activityBody) {
        activityBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center secondary-text italic">Loading recent activities...</td>
            </tr>
        `;
    }
    
    const breakdown = document.getElementById("adminQuestStatusBreakdown");
    if (breakdown) breakdown.innerHTML = `<p class="secondary-text italic text-center">Loading breakdown...</p>`;
    
    const leaderboardBody = document.getElementById("adminLeaderboardBody");
    if (leaderboardBody) {
        leaderboardBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center secondary-text italic">Loading standings...</td>
            </tr>
        `;
    }
    
    const healthBody = document.getElementById("adminUserHealthBody");
    if (healthBody) {
        healthBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center secondary-text italic">Loading health logs...</td>
            </tr>
        `;
    }
}

// 16. ERROR STATE WRAPPER
function setErrorState(err) {
    const errorBanner = document.getElementById("adminDashboardError");
    if (errorBanner) {
        errorBanner.classList.remove("hidden");
        errorBanner.innerHTML = `
            <h4 class="text-danger">⚠️ Connection / Loading Error</h4>
            <p class="secondary-text">${err.message || err}</p>
        `;
    }
}
