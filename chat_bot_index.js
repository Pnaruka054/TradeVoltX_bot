const { Markup } = require("telegraf");
const mongoose = require("mongoose");
const SupportUser = require("./models/SupportUser");
const SupportSetting = require("./models/SupportSetting");

// ====================== Helpers ======================
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function isBlockedError(err) {
    const code = err?.response?.error_code;
    const desc = (err?.response?.description || "").toLowerCase();

    if (code === 403) return true;
    if (code === 400 && (desc.includes("chat not found") || desc.includes("user not found"))) return true;
    if (desc.includes("bot was blocked by the user")) return true;
    if (desc.includes("user is deactivated")) return true;

    return false;
}

async function safeForwardMessage(bot, toChatId, fromChatId, messageId, extra = {}) {
    try {
        return await bot.telegram.forwardMessage(toChatId, fromChatId, messageId, extra);
    } catch (err) {
        const code = err?.response?.error_code;
        if (code === 429) {
            const retryAfter = Number(err?.response?.parameters?.retry_after || 1);
            await sleep((retryAfter + 1) * 1000);
            return await bot.telegram.forwardMessage(toChatId, fromChatId, messageId, extra);
        }
        throw err;
    }
}

async function safeCopyMessage(bot, toChatId, fromChatId, messageId, extra = {}) {
    try {
        return await bot.telegram.copyMessage(toChatId, fromChatId, messageId, extra);
    } catch (err) {
        const code = err?.response?.error_code;
        if (code === 429) {
            const retryAfter = Number(err?.response?.parameters?.retry_after || 1);
            await sleep((retryAfter + 1) * 1000);
            return await bot.telegram.copyMessage(toChatId, fromChatId, messageId, extra);
        }
        throw err;
    }
}

// ====================== Owner Setting (Mongo) ======================
const OWNER_KEY = "ownerTelegramId";
let ownerCache = { id: null, loadedAt: 0 };

async function getOwnerIdCached() {
    if (ownerCache.id && Date.now() - ownerCache.loadedAt < 60 * 1000) return ownerCache.id;

    const doc = await SupportSetting.findOne({ key: OWNER_KEY }).lean().catch(() => null);
    const id = Number(doc?.value || 0);

    if (!Number.isNaN(id) && id > 0) {
        ownerCache = { id, loadedAt: Date.now() };
        return id;
    }

    return null;
}

async function setOwnerId(newOwnerId) {
    const id = Number(newOwnerId);
    if (Number.isNaN(id) || id <= 0) throw new Error("Invalid owner id");

    ownerCache = { id, loadedAt: Date.now() };

    await SupportSetting.updateOne(
        { key: OWNER_KEY },
        { $set: { value: id, updatedAt: new Date() }, $setOnInsert: { key: OWNER_KEY } },
        { upsert: true }
    );
    return id;
}

async function getCurrentAdminId() {
    const doc = await SupportUser
        .findOne({ isAdmin: true }, { telegramId: 1, _id: 0 })
        .lean()
        .catch(() => null);

    const id = Number(doc?.telegramId || 0);
    if (!Number.isNaN(id) && id > 0) return id;
    return null;
}

// ====================== Main Module ======================
module.exports = (bot) => {
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD_SUPPORT || "admin123";

    const bcastState = new Map();
    const setAdminState = new Map();

    bot.start(async (ctx) => {
        // Developer Attribution
        const devUsername = process.env.DEVELOPER_TELEGRAM_USERNAME || 'Unknown';
        await ctx.reply(`Devloped by @${devUsername}`).catch(e => {});

        const from = ctx.from || {};
        const telegramId = Number(from.id);
        if (!telegramId) return;

        const existing = await SupportUser.findOne({ telegramId }).lean().catch(() => null);

        if (!existing) {
            await SupportUser.create({
                telegramId,
                username: from.username,
                firstName: from.first_name,
                lastName: from.last_name,
                isAdmin: false,
            }).catch(() => { });
        } else {
            await SupportUser.updateOne(
                { telegramId },
                {
                    $set: {
                        username: from.username,
                        firstName: from.first_name,
                        lastName: from.last_name,
                    },
                }
            ).catch(() => { });
        }

        const isAdminUser = existing?.isAdmin === true;
        if (isAdminUser) {
            await ctx.reply("Welcome back, Admin. You are the owner of this bot.");
            return;
        }

        const adminId = await getCurrentAdminId();
        if (!adminId) {
            await ctx.reply("Currently no admin is available. Please message again when an admin is available.");
            return;
        }

        await ctx.reply("Welcome! Send any message here and it will be delivered to the admin.");
    });

    bot.command("setadmin", async (ctx) => {
        const fromId = Number(ctx.from?.id);
        if (!fromId) return;

        await SupportUser.updateOne(
            { telegramId: fromId },
            {
                $set: {
                    username: ctx.from?.username,
                    firstName: ctx.from?.first_name,
                    lastName: ctx.from?.last_name,
                },
                $setOnInsert: { telegramId: fromId, createdAt: new Date(), isAdmin: false },
            },
            { upsert: true }
        ).catch(() => { });

        setAdminState.set(fromId, { step: "await_password" });
        await ctx.reply("Please enter the admin password:");
    });

    bot.command("broadcast", async (ctx) => {
        const ownerId = await getOwnerIdCached();
        if (!ownerId || Number(ctx.from?.id) !== ownerId) return;

        bcastState.set(ownerId, { step: "await_message" });
        await ctx.reply("Broadcast ke liye message bhejo (text/photo/video/document). /cancel se cancel.");
    });

    bot.command("cancel", async (ctx) => {
        const ownerId = await getOwnerIdCached();
        if (!ownerId || Number(ctx.from?.id) !== ownerId) return;

        bcastState.delete(ownerId);
        await ctx.reply("Cancelled ✅");
    });

    bot.command("users", async (ctx) => {
        const ownerId = await getOwnerIdCached();
        if (!ownerId || Number(ctx.from?.id) !== ownerId) return;

        const totalUsers = await SupportUser.countDocuments().catch(() => 0);
        await ctx.reply(`Total users in DB: ${totalUsers}`);
    });

    bot.action("BCAST_CONFIRM_NO", async (ctx) => {
        const ownerId = await getOwnerIdCached();
        if (!ownerId || Number(ctx.from?.id) !== ownerId) {
            await ctx.answerCbQuery("Not allowed", { show_alert: true }).catch(() => { });
            return;
        }

        await ctx.answerCbQuery().catch(() => { });
        bcastState.delete(ownerId);

        await ctx.editMessageText("Broadcast abort ❌").catch(async () => {
            await ctx.reply("Broadcast abort ❌").catch(() => { });
        });
    });

    bot.action("BCAST_CONFIRM_YES", async (ctx) => {
        const ownerId = await getOwnerIdCached();
        if (!ownerId || Number(ctx.from?.id) !== ownerId) {
            await ctx.answerCbQuery("Not allowed", { show_alert: true }).catch(() => { });
            return;
        }

        await ctx.answerCbQuery().catch(() => { });

        const st = bcastState.get(ownerId);
        if (!st || st.step !== "confirm") {
            await ctx.reply("Session missing. Dubara /broadcast karo.").catch(() => { });
            return;
        }

        const totalUsers = await SupportUser.countDocuments().catch(() => 0);
        await ctx.editMessageText(`Broadcast start ✅\nTotal users target: ${totalUsers}`).catch(() => { });

        let sent = 0;
        let otherFailed = 0;
        const blockedIds = [];

        const cursor = SupportUser.find({}, { telegramId: 1, _id: 0 }).lean().cursor();
        for await (const u of cursor) {
            const chatId = Number(u.telegramId);
            if (!chatId || chatId === ownerId) continue;

            try {
                await safeCopyMessage(bot, chatId, st.fromChatId, st.messageId, {
                    disable_notification: true,
                });
                sent += 1;
            } catch (err) {
                if (isBlockedError(err)) blockedIds.push(chatId);
                else otherFailed += 1;
            }
            await sleep(80);
        }

        if (blockedIds.length > 0) {
            await SupportUser.deleteMany({ telegramId: { $in: blockedIds } }).catch(() => { });
        }

        bcastState.delete(ownerId);
        await ctx.reply(`Broadcast done ✅\n\nTotal targeted: ${totalUsers}\nSent: ${sent}\nBot blocked: ${blockedIds.length}\nFailed: ${otherFailed}`);
    });

    bot.on("message", async (ctx) => {
        const from = ctx.from;
        if (!from || ctx.chat?.type !== "private") return;

        const fromId = Number(from.id);
        const stAdmin = setAdminState.get(fromId);

        if (stAdmin?.step === "await_password") {
            const text = (ctx.message?.text || "").trim();
            if (text === "/cancel") {
                setAdminState.delete(fromId);
                return ctx.reply("Cancelled.");
            }

            const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD_SUPPORT;
            if (!ADMIN_PASSWORD) {
                setAdminState.delete(fromId);
                return ctx.reply("Admin password is not configured on the server.");
            }

            if (text === ADMIN_PASSWORD) {
                await SupportUser.updateMany({ isAdmin: true }, { $set: { isAdmin: false } }).catch(() => { });
                await SupportUser.updateOne(
                    { telegramId: fromId },
                    { $set: { username: from.username, firstName: from.first_name, lastName: from.last_name, isAdmin: true } },
                    { upsert: true }
                ).catch(() => { });

                await setOwnerId(fromId).catch(() => { });
                setAdminState.delete(fromId);
                return ctx.reply("✅ You are now the admin (owner) of this bot.");
            }

            setAdminState.delete(fromId);
            return ctx.reply("❌ Incorrect password.");
        }

        await SupportUser.updateOne(
            { telegramId: fromId },
            { $set: { username: from.username, firstName: from.first_name, lastName: from.last_name } },
            { upsert: true }
        ).catch(() => { });

        if (ctx.message?.text?.startsWith("/")) return;

        const ownerId = await getOwnerIdCached();
        const adminId = await getCurrentAdminId();

        if (!adminId) {
            return ctx.reply("Currently no admin is available. Please message again when an admin is available.");
        }

        if (fromId === adminId) {
            const effectiveOwnerId = ownerId || adminId;
            const bSt = bcastState.get(effectiveOwnerId);

            if (bSt?.step === "await_message") {
                const fromChatId = ctx.chat.id;
                const messageId = ctx.message.message_id;
                await safeCopyMessage(bot, fromChatId, fromChatId, messageId).catch(() => { });
                bcastState.set(effectiveOwnerId, { step: "confirm", fromChatId, messageId });
                return ctx.reply("Kya yahi message sab users ko send karna hai?", Markup.inlineKeyboard([
                    Markup.button.callback("✅ Yes", "BCAST_CONFIRM_YES"),
                    Markup.button.callback("❌ No", "BCAST_CONFIRM_NO"),
                ]));
            }

            const replyTo = ctx.message?.reply_to_message;
            if (replyTo) {
                const targetUserId = replyTo.forward_from?.id;
                if (!targetUserId) return ctx.reply("User detect nahi ho raha. Forwarded message par reply karein.");
                try {
                    await safeCopyMessage(bot, targetUserId, ctx.chat.id, ctx.message.message_id);
                } catch (err) {
                    await ctx.reply("User ko message send fail (blocked/unreachable).");
                }
                return;
            }
        }

        try {
            await safeForwardMessage(bot, adminId, ctx.chat.id, ctx.message.message_id);
        } catch (err) {
            await ctx.reply("Your message could not be delivered to the admin. Please try again later.");
        }
    });
};
