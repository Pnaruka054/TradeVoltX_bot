const { Telegraf } = require('telegraf');

if (!process.env.PROJECT_CHAT_BOT_TOKEN) {
    console.error("❌ PROJECT_CHAT_BOT_TOKEN is missing in .env");
    process.exit(1);
}

const chatBot = new Telegraf(process.env.PROJECT_CHAT_BOT_TOKEN);

// Global Error Handler
chatBot.catch((err, ctx) => {
    console.warn(`⚠ Chat Bot Catch (${ctx.updateType}):`, err.description || err.message || err);
});

module.exports = chatBot;
