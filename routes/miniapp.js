const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const bot = require('../helpers/bot');

// Middleware to restrict access (Optional: could be improved with initData validation)
const isTelegram = (req, res, next) => {
    // In many cases, especially Telegram Web/Desktop, the User-Agent might not contain 'Telegram'.
    // We allow access but keep the middleware for future hash validation if needed.
    return next();
};

router.use(isTelegram);

const formatK = (num) => {
    if (num > 9999) {
        return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return num % 1 === 0 ? num.toString() : num.toFixed(2);
};

const Setting = require('../models/Setting');

// ... (keep formatK)

// Deposit Payment Page
router.get('/deposit', async (req, res) => {
    const { userId, amount, method } = req.query;
    if (!userId || !amount || !method) return res.status(400).send("Missing parameters");

    const user = await User.findOne({ userID: userId });
    if (!user) return res.status(404).send("User not found");

    const settings = await Setting.findOne();
    if (!settings) return res.status(500).send("Settings not configured");

    let payAmount = parseFloat(amount);
    let currency = "USDT";
    let usdtAddress = settings.depositDetails.usdt.address;
    let qrCode = settings.depositDetails.usdt.qrCodeUrl;

    res.render('pages/miniapp/deposit', {
        user,
        amount: payAmount,
        method: 'USDT',
        currency,
        qrCode,
        usdtAddress,
        formatK
    });
});

// Handle Deposit Proof Submission (Ajax)
router.post('/api/deposit/submit', async (req, res) => {
    console.log("📥 Deposit Submission Received:", req.body);
    try {
        const { userId, amount, method, txnId } = req.body;
        
        if (!userId || !amount || !method || !txnId) {
            return res.status(400).json({ success: false, error: "Missing required fields" });
        }

        const user = await User.findOne({ userID: userId });
        if (!user) return res.status(404).json({ success: false, error: "User not found" });

        // Check for duplicate Transaction ID
        const existingTx = await Transaction.findOne({ txnId: txnId });
        if (existingTx) {
            return res.status(400).json({ success: false, error: "This Transaction ID / Hash has already been submitted." });
        }

        // Create a pending transaction
        const newTx = new Transaction({
            userId: user.userID,
            telegramId: user.telegramId,
            type: 'deposit',
            amount: parseFloat(amount),
            paymentMethod: 'USDT',
            txnId: txnId,
            status: 'pending',
            description: `USDT Deposit for Plan ${amount} USDT`
        });

        await newTx.save();

        // Notify Admin via Support Bot
        notifySupportAdmin(`🆕 <b>New Deposit Request (Mini-App)</b>\n\n👤 User: ${user.firstName} (ID: <code>${user.userID}</code>)\n💰 Amount: ${amount} USDT\n💳 Method: USDT\n🔢 Hash: <code>${txnId}</code>\n\nPlease verify in the admin panel.`);

        res.json({ success: true, message: "Deposit proof submitted successfully" });
    } catch (err) {
        console.error("Deposit submission error:", err);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

// History Mini App
router.get('/history', async (req, res) => {
    const { userId, type, period } = req.query;
    if (!userId) return res.status(400).send("Missing userId");

    const user = await User.findOne({ userID: userId });
    if (!user) return res.status(404).send("User not found");

    // Generate available periods from user.createdAt to now
    const availablePeriods = [];
    const joinDate = new Date(user.createdAt);
    let currDate = new Date(joinDate.getFullYear(), joinDate.getMonth(), 1);
    const now = new Date();
    while (currDate <= now) {
        availablePeriods.push({
            value: `${currDate.getMonth() + 1}-${currDate.getFullYear()}`,
            label: `${currDate.toLocaleString('default', { month: 'short' })} ${currDate.getFullYear()}`
        });
        currDate.setMonth(currDate.getMonth() + 1);
    }
    availablePeriods.reverse(); // newest first

    let query = { userId };

    if (type && type !== 'all') {
        if (type === 'withdraw') query.type = 'withdrawal';
        else query.type = type;
    }

    if (period && period !== 'all') {
        const parts = period.split('-');
        if (parts.length === 2) {
            const m = parseInt(parts[0]);
            const y = parseInt(parts[1]);
            const startDate = new Date(y, m - 1, 1);
            const endDate = new Date(y, m, 1);
            query.createdAt = { $gte: startDate, $lt: endDate };
        }
    }

    const transactions = await Transaction.find(query).sort({ createdAt: -1 }).limit(100);

    let totalCredit = 0;
    let totalDebit = 0;

    transactions.forEach(tx => {
        if (tx.type === 'withdrawal') totalDebit += tx.amount;
        else totalCredit += tx.amount;
    });

    res.render('pages/miniapp/history', {
        user,
        transactions,
        totalCredit,
        totalDebit,
        net: totalCredit - totalDebit,
        currentType: type || 'all',
        currentPeriod: period || 'all',
        availablePeriods,
        formatK
    });
});

// Team Mini App
router.get('/team', async (req, res) => {
    let { userId, period } = req.query;
    if (!userId) return res.status(400).send("Missing userId");
    userId = userId.trim().toUpperCase();

    const user = await User.findOne({ userID: userId });
    if (!user) return res.status(404).send("User not found");

    // Generate available periods
    const availablePeriods = [];
    const joinDate = new Date(user.createdAt);
    let currDate = new Date(joinDate.getFullYear(), joinDate.getMonth(), 1);
    const now = new Date();
    while (currDate <= now) {
        availablePeriods.push({
            value: `${currDate.getMonth() + 1}-${currDate.getFullYear()}`,
            label: `${currDate.toLocaleString('default', { month: 'short' })} ${currDate.getFullYear()}`
        });
        currDate.setMonth(currDate.getMonth() + 1);
    }
    availablePeriods.reverse();

    // Monthly Filter for Team Earnings
    let teamQuery = { earnerId: userId };
    if (period && period !== 'all') {
        const parts = period.split('-');
        if (parts.length === 2) {
            const m = parseInt(parts[0]);
            const y = parseInt(parts[1]);
            const startDate = new Date(y, m - 1, 1);
            const endDate = new Date(y, m, 1);
            teamQuery.createdAt = { $gte: startDate, $lt: endDate };
        }
    }

    const teamEarningsList = await require('../models/TeamIncome').find(teamQuery);
    const totalTeamEarnings = teamEarningsList.reduce((acc, t) => acc + t.amount, 0);

    const levelMembers = {};
    for (let i = 1; i <= 3; i++) levelMembers[i] = [];

    // Full MLM tree traversal
    let currentLevelIds = [userId];
    let totalTeamMembers = 0;

    for (let level = 1; level <= 3; level++) {
        if (currentLevelIds.length === 0) break;
        const members = await User.find({ referredBy: { $in: currentLevelIds } });
        levelMembers[level] = members;
        totalTeamMembers += members.length;
        currentLevelIds = members.map(m => m.userID);
    }

    res.render('pages/miniapp/team', {
        user,
        levelMembers,
        totalTeamMembers,
        totalTeamEarnings,
        currentPeriod: period || 'all',
        availablePeriods,
        formatK
    });
});

// Leaderboard Mini App
router.get('/leaderboard', async (req, res) => {
    const { userId } = req.query;
    const user = userId ? await User.findOne({ userID: userId }) : null;

    const topEarners = await User.find({ totalEarned: { $gt: 0 } })
        .sort({ totalEarned: -1 })
        .limit(20);

    res.render('pages/miniapp/leaderboard', {
        user,
        topEarners,
        formatK
    });
});

// API endpoint for level loading (Ajax)
router.get('/api/team/:userId/:level', async (req, res) => {
    let { userId, level } = req.params;
    userId = userId.trim().toUpperCase();
    let currentLevelIds = [userId];
    let targetMembers = [];
    
    for (let i = 1; i <= parseInt(level); i++) {
        if (currentLevelIds.length === 0) break;
        targetMembers = await User.find({ referredBy: { $in: currentLevelIds } });
        currentLevelIds = targetMembers.map(m => m.userID);
    }
    
    const formatted = targetMembers.map(m => {
        const activePlans = (m.activePlans || []).filter(p => p.isActive);
        const totalAmt = activePlans.reduce((acc, p) => acc + p.planAmount, 0);
        return {
            userID: m.userID,
            firstName: m.firstName,
            isActive: activePlans.length > 0,
            planAmount: totalAmt,
            formattedPlanAmount: formatK(totalAmt),
            createdAt: m.createdAt
        };
    });
    
    res.json(formatted);
});

module.exports = router;
=> acc + p.planAmount, 0);
        return {
            userID: m.userID,
            firstName: m.firstName,
            isActive: activePlans.length > 0,
            planAmount: totalAmt,
            formattedPlanAmount: formatK(totalAmt),
            createdAt: m.createdAt
        };
    });
    
    res.json(formatted);
});

module.exports = router;
