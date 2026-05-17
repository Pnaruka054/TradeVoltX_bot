const User = require('../models/User');
const TeamIncome = require('../models/TeamIncome');
const Transaction = require('../models/Transaction');
const bot = require('./bot');

const TEAM_LEVEL_PERCENTAGES = {
    1: 0.10, // 10%
    2: 0.03, // 3%
    3: 0.02  // 2%
};

/**
 * Helper to get current Date at midnight in IST (Asia/Kolkata)
 */
function getISTDate(dateInput = new Date()) {
    const date = new Date(dateInput);
    const istString = date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const istDate = new Date(istString);
    istDate.setHours(0, 0, 0, 0);
    return istDate;
}

/**
 * Distributes commission and notifies all uplines (up to 3 levels) when a new member activates their plan.
 * @param {Object} activatedUser - The user object who just activated their plan.
 */
async function notifyUplinesOfActivation(activatedUser) {
    let currentUserId = activatedUser.userID;
    const planAmount = activatedUser.activePlans && activatedUser.activePlans.length > 0 
        ? activatedUser.activePlans[activatedUser.activePlans.length - 1].planAmount 
        : 0;

    if (planAmount <= 0) return;

    for (let level = 1; level <= 3; level++) {
        const currentUser = await User.findOne({ userID: currentUserId });
        if (!currentUser || !currentUser.referredBy) break;

        const upline = await User.findOne({ userID: currentUser.referredBy });
        if (!upline) break;

        // Check if upline has an active plan to receive commission
        const hasActivePlan = upline.activePlans && upline.activePlans.some(p => p.isActive);

        if (hasActivePlan) {
            const percentage = TEAM_LEVEL_PERCENTAGES[level];
            const commissionAmount = parseFloat((planAmount * percentage).toFixed(2));

            if (commissionAmount > 0) {
                upline.walletBalance = parseFloat((upline.walletBalance + commissionAmount).toFixed(2));
                upline.totalEarned = parseFloat((upline.totalEarned + commissionAmount).toFixed(2));
                await upline.save();

                await TeamIncome.create({
                    earnerId: upline.userID,
                    sourceId: activatedUser.userID,
                    level: level,
                    incomeType: 'plan_activation',
                    amount: commissionAmount
                });

                await Transaction.create({
                    userId: upline.userID,
                    telegramId: upline.telegramId,
                    type: 'team_income',
                    amount: commissionAmount,
                    description: `Level ${level} Commission: ${activatedUser.firstName} (${activatedUser.userID}) activated ${planAmount} USDT`,
                    level: level,
                    relatedUserId: activatedUser.userID,
                    status: 'completed'
                });

                try {
                    const msg = `🚀 <b>New Team Commission!</b>\n\nA member in your <b>Level ${level}</b> has activated a plan of ${planAmount} USDT.\n\n<b>Member:</b> ${activatedUser.firstName} (${activatedUser.userID})\n<b>Commission Earned:</b> ${commissionAmount.toFixed(2)} USDT\n<b>New Wallet Balance:</b> ${upline.walletBalance.toFixed(2)} USDT`;
                    
                    await bot.telegram.sendMessage(upline.telegramId, msg, { parse_mode: 'HTML' });
                } catch (err) {
                    console.warn(`⚠ Failed to notify upline ${upline.userID} of level ${level} commission:`, err.message);
                }
            }
        } else {
            // Optional: Notify they missed commission because they don't have an active plan
            try {
                const msg = `⚠️ <b>Missed Team Commission!</b>\n\nA member in your <b>Level ${level}</b> activated a plan of ${planAmount} USDT, but you don't have an active plan to receive the commission.\n\nActivate a plan now to earn from future team activities!`;
                await bot.telegram.sendMessage(upline.telegramId, msg, { parse_mode: 'HTML' });
            } catch (err) { }
        }

        currentUserId = upline.userID;
    }
}

/**
 * Activates a plan for a user, saves it to the database, sends a notification, and notifies uplines.
 */
async function activateUserPlan(user, amount, transactionId = null) {
    if (!user.activePlans) user.activePlans = [];
    
    const amountVal = parseFloat(parseFloat(amount).toFixed(2));
    const dailyIncome = parseFloat((amountVal * 0.02).toFixed(2));

    const newPlan = {
        planAmount: amountVal,
        dailyIncome: dailyIncome,
        startDate: getISTDate(),
        endDate: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000),
        daysCompleted: 0,
        claimsMade: 0,
        isActive: true,
        lastIncomeAt: getISTDate()
    };
    
    user.activePlans.push(newPlan);
    user.state = 'IDLE';
    await user.save();

    const Transaction = require('../models/Transaction');
    if (transactionId) {
        await Transaction.findByIdAndUpdate(
            transactionId,
            { 
                status: 'completed',
                description: `Deposit for Plan ${amount} USDT (Confirmed)`
            }
        );
    }

    try {
        await bot.telegram.sendMessage(user.telegramId, `✅ <b>Plan Activated!</b>\nYour Plan of ${amount} USDT is now Active.\nDaily Income: ${(amount * 0.02).toFixed(2)} USDT/day`, { 
            parse_mode: 'HTML', 
            disable_web_page_preview: true,
            ...bot.getMainMenu(user.userID)
        });
        // Notify Uplines
        await notifyUplinesOfActivation(user);
    } catch (e) {
        console.warn(`⚠ Telegram Notification Warning (User ${user.userID}):`, e.description || e.message);
    }
}

module.exports = {
    notifyUplinesOfActivation,
    activateUserPlan,
    getISTDate
};
