const { Telegraf, Markup } = require('telegraf');

const getMainMenu = (userID) => {
    return Markup.keyboard([
        ['👥 Invite', '💳 Payment Info'],
        ['🛒 Buy Plan', '📂 My Plans'],
        ['👛 Wallet', '💸 Payout'],
        ['🎁 Claim Profit'],
        [Markup.button.webApp('📜 History', `${process.env.GLOBAL_DOMAIN}/open-app/history?userId=${userID}`), Markup.button.webApp('🤝 Team', `${process.env.GLOBAL_DOMAIN}/open-app/team?userId=${userID}`)],
        [Markup.button.webApp('🏆 Leaderboard', `${process.env.GLOBAL_DOMAIN}/open-app/leaderboard?userId=${userID}`)],
        ['🛠 Help & Support']
    ]).resize();
};

const getWithdrawalConfirmMenu = () => {
    return Markup.keyboard([
        ['✅ Confirm Withdrawal', '❌ Cancel Withdrawal']
    ]).resize();
};

const getInactiveMenu = (userID) => {
    return Markup.keyboard([
        ['👥 Invite', '🛒 Buy Plan'],
        ['📂 My Plans', '🎁 Claim Profit'],
        [Markup.button.webApp('🤝 Team', `${process.env.GLOBAL_DOMAIN}/open-app/team?userId=${userID}`), Markup.button.webApp('🏆 Leaderboard', `${process.env.GLOBAL_DOMAIN}/open-app/leaderboard?userId=${userID}`)],
        ['🛠 Help & Support']
    ]).resize();
};

const getPaymentMenu = () => {
    return Markup.keyboard([
        ['🪙 Add/Edit USDT (BEP20)'],
        ['⬅️ Back']
    ]).resize();
};

const getPayoutMenu = () => {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🪙 USDT (BEP20)', 'WITHDRAW_USDT')]
    ]);
};

if (!process.env.PROJECT_BOT_TOKEN) {
    console.error("❌ PROJECT_BOT_TOKEN is missing in .env");
    process.exit(1);
}

const bot = new Telegraf(process.env.PROJECT_BOT_TOKEN);

// Global Error Handler for Middleware
bot.catch((err, ctx) => {
    console.warn(`⚠ Telegram Bot Catch (${ctx.updateType}):`, err.description || err.message || err);
});

// Middleware to catch async errors in handlers
bot.use(async (ctx, next) => {
    try {
        await next();
    } catch (err) {
        console.warn(`⚠ Telegram Middleware Error:`, err.description || err.message || err);
    }
});

bot.getMainMenu = getMainMenu;
bot.getInactiveMenu = getInactiveMenu;
bot.getPaymentMenu = getPaymentMenu;
module.exports = bot;
