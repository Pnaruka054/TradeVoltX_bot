const SupportSetting = require('../models/SupportSetting');
const chatBot = require('./chat_bot_instance');

async function notifySupportAdmin(message) {
    try {
        const doc = await SupportSetting.findOne({ key: 'ownerTelegramId' }).lean();
        const adminId = Number(doc?.value || 0);

        if (adminId && adminId > 0) {
            await chatBot.telegram.sendMessage(adminId, message, { parse_mode: 'HTML' });
            return true;
        } else {
            console.warn("⚠️ Support Admin (Owner) not found in settings. Use /setadmin in support bot.");
            return false;
        }
    } catch (err) {
        console.error("❌ Failed to notify Support Admin:", err.message);
        return false;
    }
}

module.exports = { notifySupportAdmin };
