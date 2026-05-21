/**
 * ==========================================================================
 * HabitQuest - Core Systems & Gamification Engine
 * ==========================================================================
 */

// 1. HARDCODED QUEST SHOP ITEMS CONSTANT
export const SHOP_ITEMS = [
    {
        id: "streakShield",
        name: "Streak Shield",
        price: 180,
        type: "utility",
        description: "Protects your Chain once when you check in a daily mission as Missed."
    },
    {
        id: "titleFocusKeeper",
        name: "Focus Keeper Title",
        price: 150,
        type: "title",
        description: "Unlocks and equips the prestiged title: Focus Keeper."
    },
    {
        id: "titleChainMaster",
        name: "Chain Master Title",
        price: 250,
        type: "title",
        description: "Unlocks and equips the elite title: Chain Master."
    },
    {
        id: "themeMidnight",
        name: "Midnight Theme",
        price: 300,
        type: "theme",
        description: "Unlocks the sleek, dark neon Midnight visual interface theme."
    },
    {
        id: "themeForest",
        name: "Forest Theme",
        price: 300,
        type: "theme",
        description: "Unlocks the warm, organic green Forest visual interface theme."
    }
];

// 2. AUTOMATIC DIFFICULTY CALCULATOR
// Score = typeScore + durationScore + frequencyScore + effortScore
export function calculateDifficulty(questType, challengeDays, frequencyPerWeek, effortVal) {
    // A. Type Score
    // simple = 1, focus = 2, multi = 3
    let typeScore = 1;
    if (questType === "focus") typeScore = 2;
    if (questType === "multi") typeScore = 3;
    
    // B. Duration Score
    // days <= 7 = 1, days <= 14 = 2, days <= 21 = 3, days > 21 = 4
    let durationScore = 1;
    const days = parseInt(challengeDays) || 14;
    if (days <= 7) durationScore = 1;
    else if (days <= 14) durationScore = 2;
    else if (days <= 21) durationScore = 3;
    else durationScore = 4;
    
    // C. Frequency Score
    // 1-3x/week = 1, 4-5x/week = 2, 6-7x/week = 3
    let frequencyScore = 3;
    const freq = parseInt(frequencyPerWeek) || 7;
    if (freq <= 3) frequencyScore = 1;
    else if (freq <= 5) frequencyScore = 2;
    else frequencyScore = 3;
    
    // D. Effort Score
    // For simple quest: effortVal is default category weight (typically 1 or 2)
    // For focus quest: effortVal is normalMinutes
    // For multi quest: effortVal is totalTargetsCount
    let effortScore = 1;
    if (questType === "simple") {
        effortScore = parseInt(effortVal) || 1;
    } else if (questType === "focus") {
        const normalMinutes = parseInt(effortVal) || 30;
        if (normalMinutes <= 15) effortScore = 1;
        else if (normalMinutes <= 45) effortScore = 2;
        else if (normalMinutes <= 90) effortScore = 3;
        else effortScore = 4;
    } else if (questType === "multi") {
        const targetCount = parseInt(effortVal) || 1;
        if (targetCount <= 1) effortScore = 1;
        else if (targetCount <= 3) effortScore = 2;
        else if (targetCount <= 5) effortScore = 3;
        else effortScore = 4;
    }
    
    const difficultyScore = typeScore + durationScore + frequencyScore + effortScore;
    
    // Difficulty Level Classification
    // 1-5 = Easy, 6-9 = Medium, 10-13 = Hard, 14+ = Extreme
    let difficultyLevel = "Easy";
    if (difficultyScore <= 5) difficultyLevel = "Easy";
    else if (difficultyScore <= 9) difficultyLevel = "Medium";
    else if (difficultyScore <= 13) difficultyLevel = "Hard";
    else difficultyLevel = "Extreme";
    
    return {
        score: difficultyScore,
        level: difficultyLevel
    };
}

// 3. REWARD & PROGRESSION UTILITIES
export function getLocalTodayString() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export function normalizeDifficultyLevel(level) {
    const value = String(level || "").toLowerCase().trim();
    if (value === "easy") return "Easy";
    if (value === "medium") return "Medium";
    if (value === "hard") return "Hard";
    if (value === "extreme") return "Extreme";
    return "Easy";
}

export function normalizeClearLevel(level) {
    const value = String(level || "")
        .toLowerCase()
        .replace(/[_-]/g, " ")
        .trim();
    if (value === "minimum") return "Minimum";
    if (value === "normal") return "Normal";
    if (value === "perfect") return "Perfect";
    if (value === "missed") return "Missed";
    if (value === "shielded missed") return "Shielded Missed";
    return "Missed";
}

export function determineFocusClearLevel(completedMinutes, quest) {
    const min = quest.minimumMinutes ?? 10;
    const normal = quest.normalMinutes ?? 30;
    const perfect = quest.perfectMinutes ?? 60;
    if (completedMinutes < min) return "Missed";
    if (completedMinutes >= perfect) return "Perfect";
    if (completedMinutes >= normal) return "Normal";
    return "Minimum";
}

export function determineMultiClearLevel(doneCount, totalCount) {
    if (!totalCount || totalCount <= 0) return "Missed";
    const ratio = doneCount / totalCount;
    if (ratio >= 1.0) return "Perfect";
    if (ratio >= 0.7) return "Normal";
    if (ratio >= 0.5) return "Minimum";
    return "Missed";
}

export function calculateReward(difficultyLevel, clearLevel) {
    const BASE_XP = 10;
    const BASE_GOLD = 10;
    
    const difficultyMultiplier = {
        Easy: 1,
        Medium: 1.3,
        Hard: 1.6,
        Extreme: 2
    };
    
    const clearMultiplier = {
        Minimum: 0.5,
        Normal: 1,
        Perfect: 1.5,
        Missed: 0,
        "Shielded Missed": 0
    };
    
    const normalizedDifficulty = normalizeDifficultyLevel(difficultyLevel);
    const normalizedClear = normalizeClearLevel(clearLevel);
    
    const diffMulti = difficultyMultiplier[normalizedDifficulty] ?? 1;
    const clearMulti = clearMultiplier[normalizedClear] ?? 0;
    
    return {
        xpEarned: Math.floor(BASE_XP * diffMulti * clearMulti),
        goldEarned: Math.floor(BASE_GOLD * diffMulti * clearMulti),
        difficultyLevel: normalizedDifficulty,
        clearLevel: normalizedClear
    };
}

// 4. LEVEL ENGINE
export function calculateLevel(xp) {
    const totalXp = parseInt(xp) || 0;
    return Math.floor(totalXp / 100) + 1;
}

// 5. QUEST HEALTH ENGINE
// >= 85% = Strong, 70%-84% = Stable, 50%-69% = At Risk, <50% = Critical
export function calculateQuestHealth(completionRate) {
    const rate = parseFloat(completionRate) || 0;
    if (rate >= 85) return "Strong";
    if (rate >= 70) return "Stable";
    if (rate >= 50) return "At Risk";
    return "Critical";
}
