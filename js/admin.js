/**
 * ==========================================================================
 * HabitQuest - Guild Master Administrative Monitoring Panel
 * ==========================================================================
 */

import { queryDocuments, mockWhere } from "./firebase-config.js";
import { getLocalTodayString } from "./systems.js";

// 1. COMPUTE AND RENDER GUILD MASTER PANEL
export async function loadAndRenderAdminPanel() {
    try {
        const todayStr = getLocalTodayString();
        
        // A. FETCH ALL RELEVANT DATA FROM DB
        // Firestore rules grant complete read access to users with role="admin"
        const usersSnap = await queryDocuments("users");
        const questsSnap = await queryDocuments("quests");
        const missionsSnap = await queryDocuments("dailyMissions");
        
        // Store records
        const allUsers = usersSnap.docs.map(d => d.data());
        const allQuests = questsSnap.docs.map(d => d.data());
        const allMissions = missionsSnap.docs.map(d => d.data());
        
        // Filter users to only normal adventurers
        const adventurers = allUsers.filter(u => u.role === "user");
        
        // B. CALCULATE STATS
        const totalUsers = adventurers.length;
        const nonArchivedQuests = allQuests.filter(q => q.status !== "Archived" && q.status !== "Abandoned");
        const totalQuests = nonArchivedQuests.length;
        const activeQuests = nonArchivedQuests.filter(q => q.status === "Active").length;
        const completedQuests = nonArchivedQuests.filter(q => q.status === "Completed").length;
        const missionsToday = allMissions.filter(m => m.date === todayStr).length;
        
        // Calculate average completion rate across non-archived quests
        let sumRate = 0;
        let countedQuests = 0;
        
        nonArchivedQuests.forEach(quest => {
            // Recompute elapsed days for completion rate calculation
            const start = new Date(quest.startDate);
            const today = new Date();
            start.setHours(0,0,0,0);
            today.setHours(0,0,0,0);
            const diffTime = Math.abs(today - start);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
            const elapsed = Math.min(diffDays, quest.challengeDays);
            
            if (elapsed > 0) {
                const rate = (quest.successfulDays / elapsed) * 100;
                sumRate += rate;
                countedQuests++;
            }
        });
        
        const avgCompletionRate = countedQuests > 0 
            ? Math.round(sumRate / countedQuests)
            : 0;
            
        // Render Top Metrics Boxes
        document.getElementById("adminTotalUsers").innerText = totalUsers;
        document.getElementById("adminActiveQuests").innerText = activeQuests;
        document.getElementById("adminTotalQuests").innerText = totalQuests;
        document.getElementById("adminCompletedQuests").innerText = completedQuests;
        document.getElementById("adminMissionsToday").innerText = missionsToday;
        document.getElementById("adminAvgCompletionRate").innerText = `${avgCompletionRate}%`;
        
        // C. COMPUTE FAILURE REASON DISTRIBUTIONS
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
        allMissions.forEach(m => {
            if (m.failureReason && failureCounts[m.failureReason] !== undefined) {
                failureCounts[m.failureReason]++;
                totalFailuresLogged++;
            }
        });
        
        renderFailureReasonChart(failureCounts, totalFailuresLogged);
        
        // Generate and display recommendation based on most common reason
        generateAdminSuggestion(failureCounts);
        
        // D. COMPUTE LEADERBOARD STANDINGS
        // Rank users by aggregate consistency (sum of successfulDays across non-archived quests)
        const userConsistencyMap = {};
        
        // Seed adventurers
        adventurers.forEach(u => {
            userConsistencyMap[u.uid || u.id] = {
                name: u.name,
                level: u.level || 1,
                successfulDays: 0
            };
        });
        
        nonArchivedQuests.forEach(quest => {
            if (userConsistencyMap[quest.userId]) {
                userConsistencyMap[quest.userId].successfulDays += (quest.successfulDays || 0);
            }
        });
        
        const sortedLeaderboard = Object.values(userConsistencyMap)
            .sort((a, b) => b.successfulDays - a.successfulDays);
            
        renderLeaderboardTable(sortedLeaderboard);
        
    } catch (err) {
        console.error("Guild Master dashboard loader failed:", err);
    }
}

// 2. RENDER THE FAILURE BAR CHARTS
function renderFailureReasonChart(failureCounts, total) {
    const container = document.getElementById("adminFailureReasonDistribution");
    if (!container) return;
    
    container.innerHTML = "";
    
    if (total === 0) {
        container.innerHTML = `<p class="secondary-text italic text-center py-md">No daily mission failures have been logged in the system yet.</p>`;
        return;
    }
    
    // Sort reasons by frequency
    const sorted = Object.entries(failureCounts).sort((a, b) => b[1] - a[1]);
    
    sorted.forEach(([reason, count]) => {
        const rate = total > 0 ? Math.round((count / total) * 100) : 0;
        
        const block = document.createElement("div");
        block.className = "failure-metric-bar";
        
        block.innerHTML = `
            <div class="flex justify-between font-bold text-xs">
                <span>⚠️ ${reason}</span>
                <span>${count} Logs (${rate}%)</span>
            </div>
            <div class="failure-bar-bg">
                <div class="failure-bar-fill" style="width: ${rate}%;"></div>
            </div>
        `;
        
        container.appendChild(block);
    });
}

// 3. GENERATE RECOMMENDATIONS BASED ON METRICS
function generateAdminSuggestion(counts) {
    const textEl = document.getElementById("adminInsightSuggestion");
    if (!textEl) return;
    
    // Find most common failure key
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const topReason = sorted[0][0];
    const topCount = sorted[0][1];
    
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

// 4. RENDER STANDINGS LEADERBOARD TABLE
function renderLeaderboardTable(standings) {
    const tbody = document.getElementById("adminLeaderboardBody");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    
    if (standings.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center secondary-text italic">No adventurers registered in the system.</td>
            </tr>`;
        return;
    }
    
    standings.forEach((user, idx) => {
        const row = document.createElement("tr");
        
        let medal = idx + 1;
        if (idx === 0) medal = "🥇 1";
        else if (idx === 1) medal = "🥈 2";
        else if (idx === 2) medal = "🥉 3";
        
        row.innerHTML = `
            <td class="font-bold">${medal}</td>
            <td class="font-bold">${user.name}</td>
            <td><span class="badge badge-outline">Lv. ${user.level}</span></td>
            <td class="font-bold text-success text-center">${user.successfulDays} Days Consistent</td>
        `;
        
        tbody.appendChild(row);
    });
}
