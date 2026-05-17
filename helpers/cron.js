const cron = require('node-cron');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdrawal');
const bot = require('./bot');
const { activateUserPlan, getISTDate } = require('./mlm');

async function processDailyIncome() {
    try {
        console.log("⏳ Starting Daily Income processing (Catch-up Mode)...");
        const today = getISTDate();
        const users = await User.find({ "activePlans.isActive": true });

        // Collector for team leader notifications to avoid spam
        const notificationCollector = new Map();

        for (const user of users) {
            let userTotalDistributed = 0;
            let userPlansExpired = 0;
            let hasChanges = false;

            for (const plan of user.activePlans) {
                if (!plan.isActive) continue;

                let lastIncomeDate = plan.lastIncomeAt ? getISTDate(plan.lastIncomeAt) : (plan.startDate ? getISTDate(plan.startDate) : null);
                if (!lastIncomeDate) continue;

                const diffTime = today.getTime() - lastIncomeDate.getTime();
                const missedDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                if (missedDays > 0) {
                    hasChanges = true;
                    console.log(`[CRON] Processing ${missedDays} missed days for user ${user.userID} plan ${plan.planAmount} USDT`);
                    let planDistributed = 0;
                    const dailyIncome = plan.dailyIncome;

                    for (let i = 1; i <= missedDays; i++) {
                        user.walletBalance += dailyIncome;
                        user.totalEarned += dailyIncome; // For Leaderboard
                        plan.daysCompleted += 1;
                        planDistributed += dailyIncome;

                        await Transaction.create({
                            userId: user.userID,
                            telegramId: user.telegramId,
                            type: 'daily_income',
                            amount: dailyIncome,
                            description: `Daily Income ${plan.planAmount} USDT Day ${plan.daysCompleted}/100 ${missedDays > 1 ? '(Catch-up)' : ''}`,
                            status: 'completed'
                        });

                        if (plan.daysCompleted >= 100) {
                            plan.isActive = false;
                            userPlansExpired += 1;
                            break;
                        }
                    }
                    userTotalDistributed += planDistributed;
                    plan.lastIncomeAt = today;
                }
            }

            if (hasChanges) {
                await user.save();

                try {
                    if (userPlansExpired > 0) {
                        await bot.telegram.sendMessage(user.telegramId, `⚠️ <b>${userPlansExpired} of your Plans have Expired!</b>\n\nYou have completed 100 days on these plans. Your daily income from them has been paused.\n\nPlease activate a new plan to continue earning.`, {
                            parse_mode: 'HTML',
                            ...bot.getMainMenu(user.userID)
                        });
                    } else {
                        const msg = `💰 <b>Daily Income Credited!</b>\nTotal Amount: ${userTotalDistributed.toFixed(2)} USDT\nWallet Balance: ${user.walletBalance.toFixed(2)} USDT`;
                        await bot.telegram.sendMessage(user.telegramId, msg, { parse_mode: 'HTML', disable_web_page_preview: true });
                    }
                } catch (e) {
                    console.error(`Failed to notify ${user.userID}:`, e.message);
                }
            }
        }

        console.log("✅ Daily Income processing completed.");
    } catch (err) {
        console.error("❌ Error in Daily Income cron:", err);
    }
}

function startCron() {
    // RUN CATCH-UP IMMEDIATELY ON STARTUP (DISABLED - ROI IS NOW MANUAL VIA CODES)
    // processDailyIncome();

    // Schedule Jobs using Asia/Kolkata timezone
    const cronOptions = { timezone: "Asia/Kolkata" };

    // Run Daily at 00:01 IST (DISABLED - ROI IS NOW MANUAL VIA CODES)
    // cron.schedule('1 0 * * *', processDailyIncome, cronOptions);

    console.log("✅ Cron jobs initialized (Automatic ROI Disabled).");
}

module.exports = startCron;
