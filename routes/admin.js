const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdrawal');
const TeamIncome = require('../models/TeamIncome');
const RoiCode = require('../models/RoiCode');
const RoiClaim = require('../models/RoiClaim');
const bot = require('../helpers/bot');
const { notifyUplinesOfActivation, activateUserPlan } = require('../helpers/mlm');
const multer = require('multer');
const path = require('path');

// Multer Config for QR Codes
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/qrcodes');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Auth Middleware
const authAdmin = (req, res, next) => {
    const token = req.cookies.admin_token;
    if (!token) return res.redirect('/admin/login');
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (err) {
        res.clearCookie('admin_token');
        res.redirect('/admin/login');
    }
};

// Pass current path to templates
router.use((req, res, next) => {
    res.locals.path = req.path;
    next();
});

// Root Redirect
router.get('/', (req, res) => {
    res.redirect('/admin/dashboard');
});

// Login Page
router.get('/login', (req, res) => {
    res.render('pages/admin/login', { layout: false, error: null });
});

router.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
        const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.cookie('admin_token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
        res.redirect('/admin/dashboard');
    } else {
        res.render('pages/admin/login', { layout: false, error: 'Invalid credentials.' });
    }
});

// Dashboard
router.get('/dashboard', authAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments() || 0;
        const activeUsers = await User.countDocuments({ "activePlans.isActive": true }) || 0;
        
        const deposits = await Transaction.find({ type: 'deposit', status: 'completed' });
        const totalDeposited = parseFloat(deposits.reduce((acc, t) => acc + (t.amount || 0), 0).toFixed(2)) || 0;
        
        const withdrawals = await Withdrawal.find({ status: 'approved' });
        const totalWithdrawn = parseFloat(withdrawals.reduce((acc, t) => acc + (t.netAmount || 0), 0).toFixed(2)) || 0;
        
        const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' }) || 0;
        const pendingDeposits = await Transaction.countDocuments({ type: 'deposit', status: 'pending' }) || 0;
        
        const today = new Date();
        today.setHours(0,0,0,0);
        const newUsersToday = await User.countDocuments({ createdAt: { $gte: today } }) || 0;
        
        const dailyIncomeDistributed = await Transaction.find({ type: 'daily_income', createdAt: { $gte: today } });
        const totalTodayIncome = parseFloat(dailyIncomeDistributed.reduce((acc, t) => acc + (t.amount || 0), 0).toFixed(2)) || 0;

        const recentTransactions = await Transaction.find().sort({ createdAt: -1 }).limit(10) || [];

        res.render('pages/admin/dashboard', {
            layout: 'admin_layout',
            stats: {
                totalUsers, 
                activeUsers, 
                totalDeposited,
                pendingWithdrawals, 
                pendingDeposits, 
                totalWithdrawn,
                newUsersToday, 
                totalTodayIncome
            },
            recentTransactions
        });
    } catch (err) {
        console.error("Dashboard calculation error:", err);
        res.status(500).send("Internal Server Error");
    }
});

// User Management
router.get('/users', authAdmin, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const search = req.query.search || '';
    const filter = req.query.filter || 'all';

    let query = {};
    if (search) {
        query = {
            $or: [
                { userID: { $regex: search, $options: 'i' } },
                { firstName: { $regex: search, $options: 'i' } },
                { telegramId: { $regex: search, $options: 'i' } }
            ]
        };
    }

    if (filter === 'active') query['activePlans.isActive'] = true;
    if (filter === 'blocked') query.isBlocked = true;

    const total = await User.countDocuments(query);
    const users = await User.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

    res.render('pages/admin/users', { 
        layout: 'admin_layout', 
        users, 
        page, 
        limit, 
        search, 
        filter,
        totalPages: Math.ceil(total / limit),
        totalRecords: total
    });
});

router.get('/users/:userId', authAdmin, async (req, res) => {
    const user = await User.findOne({ userID: req.params.userId });
    if (!user) return res.redirect('/admin/users');
    
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const { month, year } = req.query;

    let query = { userId: user.userID };
    let teamQuery = { earnerId: user.userID };
    
    if (month && year) {
        const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        const endDate = new Date(parseInt(year), parseInt(month), 1);
        query.createdAt = { $gte: startDate, $lt: endDate };
        teamQuery.createdAt = { $gte: startDate, $lt: endDate };
    }

    const txTotal = await Transaction.countDocuments(query);
    const transactions = await Transaction.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);
        
    const withdrawals = await Withdrawal.find({ userId: user.userID }).sort({ createdAt: -1 });
    
    // Team Stats
    const teamEarnings = await TeamIncome.find(teamQuery);
    const totalTeamEarnings = teamEarnings.reduce((acc, t) => acc + t.amount, 0);
    const level1 = await User.find({ referredBy: user.userID });
    
    res.render('pages/admin/user_detail', { 
        layout: 'admin_layout', 
        user, 
        transactions, 
        withdrawals,
        totalTeamEarnings,
        level1,
        currentPage: page,
        totalPages: Math.ceil(txTotal / limit),
        currentMonth: month || (new Date().getMonth() + 1),
        currentYear: year || new Date().getFullYear(),
        query: req.query
    });
});

router.post('/users/:userId/block', authAdmin, async (req, res) => {
    await User.updateOne({ userID: req.params.userId }, { isBlocked: true });
    res.redirect(`/admin/users/${req.params.userId}`);
});

router.post('/users/:userId/unblock', authAdmin, async (req, res) => {
    await User.updateOne({ userID: req.params.userId }, { isBlocked: false });
    res.redirect(`/admin/users/${req.params.userId}`);
});

router.post('/users/:userId/adjust-balance', authAdmin, async (req, res) => {
    const { amount, actionType, reason } = req.body;
    const user = await User.findOne({ userID: req.params.userId });
    
    if (user) {
        const adjustAmount = parseFloat(parseFloat(amount).toFixed(2));
        if (actionType === 'subtract') {
            if (user.walletBalance < adjustAmount) {
                return res.redirect(`/admin/users/${req.params.userId}?error=Insufficient balance for deduction`);
            }
            user.walletBalance = parseFloat((user.walletBalance - adjustAmount).toFixed(2));
        } else {
            user.walletBalance = parseFloat((user.walletBalance + adjustAmount).toFixed(2));
            user.totalEarned = parseFloat((user.totalEarned + adjustAmount).toFixed(2));
        }

        await user.save();
        
        await Transaction.create({
            userId: user.userID,
            telegramId: user.telegramId,
            type: actionType === 'add' ? 'daily_income' : 'withdrawal',
            amount: adjustAmount,
            description: `${reason} (Admin Adjusted)`,
            status: 'completed'
        });
    }
    res.redirect(`/admin/users/${req.params.userId}`);
});

router.post('/users/:userId/activate-plan', authAdmin, async (req, res) => {
    const { planAmount } = req.body;
    const amount = parseFloat(parseFloat(planAmount).toFixed(2));
    const user = await User.findOne({ userID: req.params.userId });
    
    if (user && amount > 0) {
        await activateUserPlan(user, amount);
    }
    res.redirect(`/admin/users/${req.params.userId}`);
});

const Setting = require('../models/Setting');

// ... (keep authAdmin and path middleware)

// Settings Page
router.get('/settings', authAdmin, async (req, res) => {
    let settings = await Setting.findOne();
    if (!settings) {
        settings = await Setting.create({});
    }
    res.render('pages/admin/settings', { layout: 'admin_layout', settings });
});

router.post('/settings', authAdmin, upload.fields([{ name: 'usdtQr', maxCount: 1 }]), async (req, res) => {
    const { usdtAddress } = req.body;
    let settings = await Setting.findOne();
    if (!settings) settings = new Setting();

    settings.depositDetails.usdt.address = usdtAddress;

    if (req.files['usdtQr']) {
        settings.depositDetails.usdt.qrCodeUrl = '/uploads/qrcodes/' + req.files['usdtQr'][0].filename;
    }

    settings.updatedAt = Date.now();
    await settings.save();
    res.redirect('/admin/settings');
});

// Deposit Management
router.get('/deposits', authAdmin, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const search = req.query.search || '';
    const filter = req.query.status || 'pending';

    let query = { type: 'deposit' };
    if (filter !== 'all') query.status = filter;
    
    if (search) {
        query.$or = [
            { userId: { $regex: search, $options: 'i' } },
            { txnId: { $regex: search, $options: 'i' } }
        ];
    }

    const total = await Transaction.countDocuments(query);
    const deposits = await Transaction.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

    res.render('pages/admin/deposits', { 
        layout: 'admin_layout', 
        deposits, 
        currentFilter: filter,
        page,
        limit,
        search,
        totalPages: Math.ceil(total / limit),
        totalRecords: total
    });
});

router.post('/deposits/:id/approve', authAdmin, async (req, res) => {
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.type !== 'deposit' || tx.status !== 'pending') return res.redirect('/admin/deposits');

    const user = await User.findOne({ userID: tx.userId });
    if (!user) return res.redirect('/admin/deposits?error=User not found');

    // Activate the plan
    await activateUserPlan(user, tx.amount, tx._id);

    // Transaction is updated inside activateUserPlan, but let's be sure
    tx.status = 'completed';
    await tx.save();

    try {
        await bot.telegram.sendMessage(user.telegramId, `✅ <b>Deposit Approved!</b>\nYour deposit of ${tx.amount.toFixed(2)} USDT has been verified and your plan is now active.`, { parse_mode: 'HTML' });
    } catch (e) {}

    res.redirect('/admin/deposits');
});

router.post('/deposits/:id/reject', authAdmin, async (req, res) => {
    const { reason } = req.body;
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.type !== 'deposit' || tx.status !== 'pending') return res.redirect('/admin/deposits');

    tx.status = 'rejected';
    tx.rejectionReason = reason;
    await tx.save();

    try {
        await bot.telegram.sendMessage(tx.telegramId, `❌ <b>Deposit Rejected</b>\nYour deposit of ${tx.amount.toFixed(2)} USDT was rejected.\nReason: ${reason}`, { parse_mode: 'HTML' });
    } catch (e) {}

    res.redirect('/admin/deposits');
});

// Withdrawal Management
router.get('/withdrawals', authAdmin, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const search = req.query.search || '';
    const filter = req.query.status || 'pending';

    let query = filter === 'all' ? {} : { status: filter };
    if (search) {
        query.$or = [
            { userId: { $regex: search, $options: 'i' } },
            { telegramId: { $regex: search, $options: 'i' } }
        ];
    }

    const total = await Withdrawal.countDocuments(query);
    const withdrawals = await Withdrawal.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

    res.render('pages/admin/withdrawals', { 
        layout: 'admin_layout', 
        withdrawals, 
        currentFilter: filter,
        page,
        limit,
        search,
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        gatewayError: req.query.error || null
    });
});

// Update Withdrawal Status
router.post('/withdrawals/:id/approve', authAdmin, async (req, res) => {
    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal || withdrawal.status !== 'pending') return res.redirect('/admin/withdrawals');

    withdrawal.status = 'approved';
    await withdrawal.save();

    await Transaction.updateOne({ userId: withdrawal.userId, type: 'withdrawal', status: 'pending' }, { 
        status: 'completed',
        description: `Withdrawal Approved - Net ${withdrawal.netAmount.toFixed(2)} USDT (20% Fee: ${withdrawal.taxAmount.toFixed(2)} USDT)`
    });

    try {
        let netDisplay = `${withdrawal.netAmount.toFixed(2)} USDT`;
        let botFeeDisplay = `${(withdrawal.amount * 0.15).toFixed(2)} USDT`;
        let adminFeeDisplay = `${(withdrawal.amount * 0.05).toFixed(2)} USDT`;

        const msg = `✅ <b>Withdrawal Approved!</b>\n\nYour withdrawal request has been approved and processed.\n\n💰 <b>Net Amount Sent:</b> ${netDisplay}\n\n<b>Fees Breakdown:</b>\n🤖 Bot Fees (15%): ${botFeeDisplay}\n👤 Admin Fees (5%): ${adminFeeDisplay}\n\nPlease check your account shortly.`;

        await bot.telegram.sendMessage(withdrawal.telegramId, msg, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (e) {
        console.warn(`⚠ Telegram Notification Warning (User ${withdrawal.userId}):`, e.description || e.message);
    }
    res.redirect('/admin/withdrawals');
});

// (Keep reject as is but it already handles refund)


router.post('/withdrawals/:id/reject', authAdmin, async (req, res) => {
    const { reason } = req.body;
    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal || withdrawal.status !== 'pending') return res.redirect('/admin/withdrawals');

    withdrawal.status = 'rejected';
    withdrawal.rejectionReason = reason;
    await withdrawal.save();

    const user = await User.findOne({ userID: withdrawal.userId });
    if (user) {
        user.walletBalance = parseFloat((user.walletBalance + withdrawal.amount).toFixed(2));
        await user.save();
    }

    await Transaction.updateOne({ userId: withdrawal.userId, type: 'withdrawal', status: 'pending' }, { 
        status: 'rejected', 
        rejectionReason: reason,
        description: `Withdrawal Rejected & Refunded (${withdrawal.amount.toFixed(2)} USDT)`
    });

    try {
        let displayAmount = `${withdrawal.amount.toFixed(2)} USDT`;

        await bot.telegram.sendMessage(withdrawal.telegramId, `❌ <b>Withdrawal Rejected!</b>\n\nYour withdrawal request of ${displayAmount} was rejected.\n\n<b>Reason:</b> ${reason}\n\n💰 The full amount has been refunded to your wallet balance.`, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (e) {
        console.warn(`⚠ Telegram Notification Warning (User ${withdrawal.userId}):`, e.description || e.message);
    }

    res.redirect('/admin/withdrawals');
});

// Transactions
router.get('/transactions', authAdmin, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const search = req.query.search || '';
    const type = req.query.type || 'all';

    let query = type === 'all' ? {} : { type };
    if (search) {
        query.$or = [
            { userId: { $regex: search, $options: 'i' } },
            { telegramId: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
        ];
    }

    const total = await Transaction.countDocuments(query);
    const transactions = await Transaction.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

    res.render('pages/admin/transactions', { 
        layout: 'admin_layout', 
        transactions, 
        page, 
        limit, 
        search, 
        type,
        totalPages: Math.ceil(total / limit),
        totalRecords: total
    });
});

// Team Income Logs
router.get('/team-income', authAdmin, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const search = req.query.search || '';

    let query = {};
    if (search) {
        query.$or = [
            { earnerId: { $regex: search, $options: 'i' } },
            { sourceId: { $regex: search, $options: 'i' } }
        ];
    }

    const total = await TeamIncome.countDocuments(query);
    const logs = await TeamIncome.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

    res.render('pages/admin/team_income', { 
        layout: 'admin_layout', 
        logs, 
        page, 
        limit, 
        search, 
        totalPages: Math.ceil(total / limit),
        totalRecords: total
    });
});

// Update Transaction Status (Manual Override)
router.post('/transactions/:id/update-status', authAdmin, async (req, res) => {
    const { status, reason } = req.body;
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).send("Transaction not found");

    const oldStatus = tx.status;
    tx.status = status;
    if (reason) tx.rejectionReason = reason;
    await tx.save();

    // If it's a deposit and status changed to completed, activate plan
    if (tx.type === 'deposit' && status === 'completed' && oldStatus !== 'completed') {
        const user = await User.findOne({ userID: tx.userId });
        if (user) {
            await activateUserPlan(user, tx.amount, tx._id);
        }
    }

    res.redirect(req.header('Referer') || '/admin/transactions');
});

// Update Withdrawal Status (Manual Override)
router.post('/withdrawals/:id/update-status', authAdmin, async (req, res) => {
    const { status, reason } = req.body;
    const wd = await Withdrawal.findById(req.params.id);
    if (!wd) return res.status(404).send("Withdrawal not found");

    const oldStatus = wd.status;
    
    // Handle balance refund if changing from pending/approved to rejected
    if (status === 'rejected' && (oldStatus === 'pending' || oldStatus === 'approved')) {
        const user = await User.findOne({ userID: wd.userId });
        if (user) {
            user.walletBalance = parseFloat((user.walletBalance + wd.amount).toFixed(2));
            await user.save();
            
            await Transaction.create({
                userId: user.userID,
                telegramId: user.telegramId,
                type: 'deposit', // Refund is essentially a deposit
                amount: wd.amount,
                description: `Withdrawal Refund (Admin Manual Override: ${wd._id})`,
                status: 'completed'
            });

            try {
                let displayAmount = `${wd.amount.toFixed(2)} USDT`;

                await bot.telegram.sendMessage(user.telegramId, `❌ <b>Withdrawal Status Updated</b>\nYour withdrawal of ${displayAmount} has been rejected by admin.\nThe amount has been refunded to your wallet.\nReason: ${reason || 'Manual Adjustment'}`, { parse_mode: 'HTML' });
            } catch (e) {}
        }
    }

    wd.status = status;
    if (reason) wd.rejectionReason = reason;
    await wd.save();

    res.redirect(req.header('Referer') || '/admin/withdrawals');
});

// ROI Codes Management
router.get('/roi-codes', authAdmin, async (req, res) => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const codes = await RoiCode.find({ createdAt: { $gte: today, $lt: tomorrow } }).sort({ createdAt: -1 });
    const claimCounts = {};
    
    for (const code of codes) {
        claimCounts[code._id] = await RoiClaim.countDocuments({ codeId: code._id });
    }

    res.render('pages/admin/roi_codes', { 
        layout: 'admin_layout', 
        codes, 
        claimCounts,
        canGenerate: codes.length < 2 
    });
});

router.post('/roi-codes/generate', authAdmin, async (req, res) => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const existingCodesCount = await RoiCode.countDocuments({ createdAt: { $gte: today, $lt: tomorrow } });
    
    if (existingCodesCount >= 2) {
        return res.status(400).send("Maximum 2 codes can be generated per day.");
    }

    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars like O, 0, I, 1
    let randomCode = '';
    for (let i = 0; i < 8; i++) {
        randomCode += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now

    await RoiCode.create({
        code: randomCode,
        expiresAt: expiresAt
    });

    res.redirect('/admin/roi-codes');
});

module.exports = router;
