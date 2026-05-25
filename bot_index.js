const { Markup } = require('telegraf');
const User = require('./models/User');
const Transaction = require('./models/Transaction');
const Withdrawal = require('./models/Withdrawal');
const Setting = require('./models/Setting');
const RoiCode = require('./models/RoiCode');
const RoiClaim = require('./models/RoiClaim');
const { notifyUplinesOfActivation, getISTDate, getCurrentISTTime } = require('./helpers/mlm');
const { notifySupportAdmin } = require('./helpers/notifier');

const PLANS = [30, 50, 100, 200, 500, 1000];

const STATES = {
    IDLE: 'IDLE',
    SELECTING_PLAN: 'SELECTING_PLAN',
    AWAITING_DEPOSIT_PROOF: 'AWAITING_DEPOSIT_PROOF',
    ENTERING_WITHDRAWAL_AMOUNT: 'ENTERING_WITHDRAWAL_AMOUNT',
    CONFIRMING_WITHDRAWAL: 'CONFIRMING_WITHDRAWAL',
    ENTERING_SAVED_USDT: 'ENTERING_SAVED_USDT',
    ENTERING_ROI_CODE: 'ENTERING_ROI_CODE'
};

const fs = require('fs');
const path = require('path');

const PDF_CACHE_FILE = path.join(__dirname, 'cache', 'pdf_fileid.txt');
let cachedFileId = null;

// Load cached file_id from disk on startup
function loadCachedPdfFileId() {
    try {
        if (fs.existsSync(PDF_CACHE_FILE)) {
            cachedFileId = fs.readFileSync(PDF_CACHE_FILE, 'utf8').trim();
            if (cachedFileId) {
                console.log('✅ Plan PDF File ID loaded from disk cache:', cachedFileId);
            }
        } else {
            console.log('ℹ️ No PDF cache found. Will cache on first /start request.');
        }
    } catch (err) {
        console.warn('⚠️ Could not read PDF cache file:', err.message);
    }
}

// Save file_id to disk after first successful upload
function savePdfFileId(fileId) {
    try {
        const cacheDir = path.join(__dirname, 'cache');
        if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(PDF_CACHE_FILE, fileId, 'utf8');
        console.log('✅ Plan PDF File ID saved to disk cache.');
    } catch (err) {
        console.warn('⚠️ Could not save PDF cache file:', err.message);
    }
}


function generateUserID() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    let id = '';
    for(let i=0; i<3; i++) id += letters.charAt(Math.floor(Math.random() * letters.length));
    for(let i=0; i<3; i++) id += digits.charAt(Math.floor(Math.random() * digits.length));
    return id;
}

async function showPlanSelection(ctx, user) {
    user.state = STATES.SELECTING_PLAN;
    await user.save();

    let welcomeMsg = `🌟 <b>Welcome to ${process.env.MINI_APP_NAME_PROJECT} Bot!</b>\n\nYour Unique ID: <code>${user.userID}</code>\n\n💰 Start earning daily 2% with our investment plans.\nChoose a plan below to get started:\n\n<i>Note: You can hold different plan types at the same time.</i>`;
    
    const activeAmounts = (user.activePlans || []).filter(p => p.isActive).map(p => p.planAmount);
    const availablePlans = PLANS.filter(amount => !activeAmounts.includes(amount));

    if (availablePlans.length === 0) {
        return ctx.reply("✅ <b>All our investment plans are currently active for you!</b>\n\nYou are already earning maximum ROI. You can buy more plans once your current ones expire after 100 days.", { parse_mode: 'HTML' });
    }

    const planButtons = availablePlans.map(amount => {
        return [Markup.button.callback(`💎 Plan ${amount} USDT  →  ${(amount * 0.02).toFixed(2)} USDT/day for 100 days`, `PLAN_${amount}`)];
    });

    return ctx.reply(welcomeMsg, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: planButtons
        }
    });
}

module.exports = (bot) => {
    // Load PDF file_id from disk cache on startup
    loadCachedPdfFileId();

    bot.use(async (ctx, next) => {
        if (ctx.from && ctx.chat && ctx.chat.type === 'private') {
            let user = await User.findOne({ telegramId: ctx.from.id.toString() });
            if (user && user.isBlocked) {
                return ctx.reply("❌ You are blocked. Contact support.");
            }
        }
        return next();
    });

    bot.start(async (ctx) => {
        // Developer Attribution
        const devUsername = process.env.DEVELOPER_TELEGRAM_USERNAME || 'Unknown';
        await ctx.reply(`Devloped by @${devUsername}`).catch(e => {});

        let payload = ctx.startPayload ? ctx.startPayload.trim().toUpperCase() : null;
        const telegramId = ctx.from.id.toString();
        
        let user = await User.findOne({ telegramId });
        
        if (!user) {
            let newId = generateUserID();
            while (await User.findOne({ userID: newId })) {
                newId = generateUserID();
            }

            let referredBy = null;
            if (payload && (payload.length === 6 || payload.length === 7)) {
                const referrer = await User.findOne({ userID: payload });
                if (referrer) referredBy = payload;
            }

            user = await User.create({
                telegramId,
                username: ctx.from.username,
                firstName: ctx.from.first_name,
                lastName: ctx.from.last_name,
                userID: newId,
                referredBy
            });
        } else if (!user.referredBy && payload && (payload.length === 6 || payload.length === 7)) {
            const referrer = await User.findOne({ userID: payload });
            if (referrer && referrer.userID !== user.userID) {
                user.referredBy = payload;
                await user.save();
            }
        }

        try {
            const hasActivePlans = user.activePlans && user.activePlans.some(p => p.isActive);
            const menu = hasActivePlans ? bot.getMainMenu(user.userID) : bot.getInactiveMenu(user.userID);
            
            if (cachedFileId) {
                try {
                    await ctx.replyWithDocument(cachedFileId, { 
                        caption: '📖 <b>Check out our official Investment Plan</b>', 
                        parse_mode: 'HTML',
                        ...menu
                    });
                } catch (e) {
                    // If cached file_id fails, try sending the file directly
                    console.warn("Cached PDF failed, trying direct upload...");
                    const sent = await ctx.replyWithDocument({ source: './public/plan_pdf.pdf' }, { 
                        caption: '📖 <b>Check out our official Investment Plan</b>', 
                        parse_mode: 'HTML',
                        ...menu
                    });
                    if (sent && sent.document && sent.document.file_id) {
                        cachedFileId = sent.document.file_id;
                        savePdfFileId(cachedFileId);
                    }
                }
            } else {
                const sent = await ctx.replyWithDocument({ source: './public/plan_pdf.pdf' }, { 
                    caption: '📖 <b>Check out our official Investment Plan</b>', 
                    parse_mode: 'HTML',
                    ...menu
                });
                if (sent && sent.document && sent.document.file_id) {
                    cachedFileId = sent.document.file_id;
                    savePdfFileId(cachedFileId);
                }
            }
        } catch (err) {
            console.warn("Could not send plan PDF:", err.message);
            // Fallback: Send a simple message with the menu if PDF fails entirely
            const hasActivePlans = user.activePlans && user.activePlans.some(p => p.isActive);
            const menu = hasActivePlans ? bot.getMainMenu(user.userID) : bot.getInactiveMenu(user.userID);
            await ctx.reply("👋 <b>Welcome!</b> Use the menu below to navigate.", { parse_mode: 'HTML', ...menu });
        }

        const activePlans = (user.activePlans || []).filter(p => p.isActive);
        if (activePlans.length > 0) {
            user.state = STATES.IDLE;
            await user.save();
            
            // Show summary of first active plan or general summary
            const primaryPlan = activePlans[0];
            const msg = `👤 <b>${user.firstName}</b> | ID: <code>${user.userID}</code>\n💰 Wallet: ${user.walletBalance.toFixed(2)} USDT\n📊 Active Plans: ${activePlans.length}\n📅 Primary Plan: ${primaryPlan.planAmount} USDT | Day ${primaryPlan.daysCompleted}/100`;
            return ctx.reply(msg, { parse_mode: 'HTML', ...bot.getMainMenu(user.userID) });
        }

        return showPlanSelection(ctx, user);
    });

    // Handle Plan Selection
    bot.action(/PLAN_(\d+)/, async (ctx) => {
        await ctx.answerCbQuery();
        const amount = parseInt(ctx.match[1]);
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        
        if (!user) return;

        // Skip if already active this specific plan (multiple plans check)
        const activeAmounts = (user.activePlans || []).filter(p => p.isActive).map(p => p.planAmount);
        if (activeAmounts.includes(amount)) return;

        user.sessionData = { planAmount: amount, method: 'USDT' };
        user.state = STATES.AWAITING_DEPOSIT_PROOF;
        user.markModified('sessionData');
        await user.save();

        const usdtLink = `${process.env.GLOBAL_DOMAIN}/open-app/deposit?userId=${user.userID}&amount=${amount}&method=USDT`;

        const msg = `💳 <b>Deposit for Plan ${amount} USDT</b>\n\nClick the button below to open the secure payment page and complete your USDT (BEP20) deposit:`;
        const buttons = Markup.inlineKeyboard([
            [
                Markup.button.url('🪙 USDT (BEP20)', usdtLink)
            ],
            [Markup.button.callback('⬅️ Back to Plans', '🛒 Buy Plan')]
        ]);

        ctx.editMessageText(msg, { parse_mode: 'HTML', ...buttons });
    });

    bot.action('DEP_USDT', async (ctx) => {
        // Obsolete
        await ctx.answerCbQuery("Please re-select your plan.");
    });

    // Menus
    bot.hears('👥 Invite', async (ctx) => {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        const refLink = `https://t.me/${process.env.BOT_USERNAME_PROJECT}?start=${user.userID}`;
        const msg = `🔗 <b>Your Referral Link:</b>\n<code>${refLink}</code>\n\n📋 <b>Your Unique ID:</b> <code>${user.userID}</code>\n\nShare this link with friends and earn team income when they buy a plan!\n\nLevel 1: 10% of Plan Amount\nLevel 2: 3% of Plan Amount\nLevel 3: 2% of Plan Amount`;
        ctx.reply(msg, { parse_mode: 'HTML', disable_web_page_preview: true });
    });

    bot.hears('🛒 Buy Plan', async (ctx) => {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;
        return showPlanSelection(ctx, user);
    });

    bot.hears('🛠 Help & Support', async (ctx) => {
        const username = process.env.PROJECT_CHAT_BOT_USERNAME || 'SupportBot';
        const msg = `🛠 <b>Customer Support</b>\n\nClick the button below to start a chat with our support team.`;
        const buttons = Markup.inlineKeyboard([
            [Markup.button.url('💬 Contact Support', `https://t.me/${username}`)]
        ]);
        ctx.reply(msg, { parse_mode: 'HTML', ...buttons });
    });

    bot.hears('📂 My Plans', async (ctx) => {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        if (!user.activePlans || user.activePlans.length === 0) {
            return ctx.reply("❌ You don't have any active plans. Click <b>'🛒 Buy Plan'</b> to get started.", { parse_mode: 'HTML' });
        }

        let msg = `📂 <b>Your Investment Plans</b>\n\n`;
        user.activePlans.forEach((plan, index) => {
            const status = plan.isActive ? '✅ Active' : '⌛ Expired';
            msg += `<b>Plan #${index + 1}: ${plan.planAmount} USDT</b>\n`;
            msg += `Status: ${status}\n`;
            msg += `Daily Income: ${plan.dailyIncome.toFixed(2)} USDT\n`;
            msg += `Progress: ${plan.daysCompleted}/100 Days\n`;
            if (plan.startDate) {
                msg += `Started: ${new Date(plan.startDate).toLocaleDateString('en-IN')}\n`;
            }
            msg += `\n`;
        });

        ctx.reply(msg, { parse_mode: 'HTML' });
    });

    bot.hears('👛 Wallet', async (ctx) => {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;
        
        const activeCount = user.activePlans ? user.activePlans.filter(p => p.isActive).length : 0;
        if (activeCount === 0) return showPlanSelection(ctx, user);
        
        const txs = await Transaction.find({ userId: user.userID, status: 'completed' });
        let totalDaily = 0, totalTeam = 0, totalWithdrawn = 0;
        
        txs.forEach(t => {
            if (t.type === 'daily_income') totalDaily = parseFloat((totalDaily + t.amount).toFixed(2));
            if (t.type === 'team_income') totalTeam = parseFloat((totalTeam + t.amount).toFixed(2));
            if (t.type === 'withdrawal') totalWithdrawn = parseFloat((totalWithdrawn + t.amount).toFixed(2));
        });

        const totalActiveAmount = user.activePlans.filter(p => p.isActive).reduce((acc, p) => acc + p.planAmount, 0);
        const msg = `👛 <b>Your Wallet</b>\n💰 Available Balance: ${user.walletBalance.toFixed(2)} USDT\n\n📊 <b>Earnings Summary:</b>\nTotal Daily Income: ${totalDaily.toFixed(2)} USDT\nTotal Team Income: ${totalTeam.toFixed(2)} USDT\nTotal Withdrawn: ${totalWithdrawn.toFixed(2)} USDT\n\n🗓️ <b>Plan Status:</b> ${activeCount} Active Plans (${totalActiveAmount} USDT)`;
        
        const btns = Markup.inlineKeyboard([
            [Markup.button.callback('💸 Withdraw', 'BTN_WITHDRAW')]
        ]);
        ctx.reply(msg, { parse_mode: 'HTML', ...btns });
    });

    bot.action('EDIT_USDT', async (ctx) => {
        await ctx.answerCbQuery();
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;
        user.state = STATES.ENTERING_SAVED_USDT;
        await user.save();
        ctx.reply("🪙 <b>Please enter your USDT (BEP20) Address:</b>", { parse_mode: 'HTML' });
    });

    bot.action('BTN_WITHDRAW', withdrawInit);
    bot.hears('💸 Payout', withdrawInit);

    async function withdrawInit(ctx) {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;
        
        const hasActivePlans = user.activePlans && user.activePlans.some(p => p.isActive);
        if (!hasActivePlans) return showPlanSelection(ctx, user);
        
        user.state = STATES.ENTERING_WITHDRAWAL_AMOUNT;
        user.sessionData = { method: 'USDT' };
        user.markModified('sessionData');
        await user.save();

        const msg = `💸 <b>Withdraw Funds</b>\nAvailable Balance: ${user.walletBalance.toFixed(2)} USDT\nMinimum Withdrawal: 10 USDT\n\n<b>Enter the amount in USDT you want to withdraw:</b>`;

        if(ctx.callbackQuery) {
            await ctx.answerCbQuery();
        }
        ctx.reply(msg, { parse_mode: 'HTML' });
    }

    bot.hears('💳 Payment Info', async (ctx) => {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;
        
        const hasActivePlans = user.activePlans && user.activePlans.some(p => p.isActive);
        if (!hasActivePlans) return showPlanSelection(ctx, user);
        
        let msg = `💳 <b>Payment Information</b>\n\n`;
        msg += `🪙 <b>USDT Address:</b> <code>${user.bankDetails.usdtAddress || 'Not Set'}</code>\n`;
        msg += `🌐 <b>Network:</b> ${user.bankDetails.usdtNetwork}\n\n`;
        msg += `Use the menu below to add or update your details. These will be used for your withdrawals.`;

        ctx.reply(msg, { parse_mode: 'HTML', ...bot.getPaymentMenu() });
    });

    bot.hears('🪙 Add/Edit USDT (BEP20)', async (ctx) => {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;
        
        user.state = STATES.ENTERING_SAVED_USDT;
        await user.save();
        ctx.reply("🪙 <b>Please enter your USDT (BEP20) Address:</b>", { parse_mode: 'HTML' });
    });

    bot.hears('⬅️ Back', async (ctx) => {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;
        
        user.state = STATES.IDLE;
        await user.save();
        
        ctx.reply("🔙 Returning to Main Menu.", bot.getMainMenu(user.userID));
    });

    bot.on('photo', async (ctx) => {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user || user.state !== STATES.AWAITING_DEPOSIT_PROOF) return;

        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileId = photo.file_id;
        const amount = parseFloat(parseFloat(user.sessionData.planAmount).toFixed(2));
        const method = user.sessionData.method;

        await Transaction.create({
            userId: user.userID,
            telegramId: user.telegramId,
            type: 'deposit',
            amount: amount,
            description: `Manual ${method} Deposit for Plan ${amount.toFixed(2)} USDT`,
            status: 'pending',
            paymentMethod: method,
            paymentScreenshot: fileId
        });

        user.state = STATES.IDLE;
        user.sessionData = {};
        user.markModified('sessionData');
        await user.save();

        ctx.reply("✅ <b>Deposit proof submitted!</b>\n\nAdmin will verify your payment and activate your plan shortly. You will be notified once it is approved.", { parse_mode: 'HTML', ...bot.getInactiveMenu(user.userID) });

        // Notify Support Admin
        notifySupportAdmin(`🆕 <b>New Deposit Request (Photo)</b>\n\n👤 User: ${user.firstName} (ID: <code>${user.userID}</code>)\n💰 Plan: ${amount} USDT\n💳 Method: ${method}\n\nPlease check the admin panel.`);
    });

    bot.hears('🎁 Claim Profit', async (ctx) => {
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        const hasActivePlans = user.activePlans && user.activePlans.some(p => p.isActive);
        if (!hasActivePlans) {
            return ctx.reply("❌ You don't have any active investment plans to claim profit from.", { parse_mode: 'HTML' });
        }

        user.state = STATES.ENTERING_ROI_CODE;
        await user.save();

        ctx.reply("🎁 <b>Claim Your Profit</b>\n\nPlease enter the daily ROI code provided by the Admin in the official channel:", { parse_mode: 'HTML' });
    });

    bot.on('text', async (ctx) => {
        const text = ctx.message.text.trim();
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user) return;

        // SKIP if it's a menu button text to avoid 'Invalid Amount' errors
        const menuButtons = ['🪙 USDT (BEP20)', '💳 Payment Info', '💸 Payout', '⬅️ Back', '👥 Invite', '🛒 Buy Plan', '📂 My Plans', '👛 Wallet', '🎁 Claim Profit'];
        if (menuButtons.includes(text)) return;

        if (user.state === STATES.ENTERING_ROI_CODE) {
            const inputCode = text.toUpperCase();
            const roiCode = await RoiCode.findOne({ code: inputCode });

            if (!roiCode) {
                return ctx.reply("❌ <b>Invalid Code!</b>\nPlease check the code and try again.", { parse_mode: 'HTML' });
            }

            if (getCurrentISTTime() > roiCode.expiresAt) {
                return ctx.reply("⏰ <b>Code Expired!</b>\nThis code was only valid for 30 minutes. You missed this claim.", { parse_mode: 'HTML' });
            }

            const alreadyClaimed = await RoiClaim.findOne({ userId: user.userID, codeId: roiCode._id });
            if (alreadyClaimed) {
                return ctx.reply("⚠️ <b>Already Claimed!</b>\nYou have already claimed your profit using this code.", { parse_mode: 'HTML' });
            }

            // Get Current IST Date at midnight for comparison
            const todayIST = getISTDate();

            // Calculate 50% ROI
            let totalClaimAmount = 0;
            let plansUpdated = 0;
            let newlyActivePlansCount = 0;

            user.activePlans.forEach(plan => {
                if (plan.isActive) {
                    // Check if plan was activated before today
                    const planStartDateIST = getISTDate(plan.startDate);
                    if (planStartDateIST < todayIST) {
                        const halfDaily = parseFloat((plan.dailyIncome / 2).toFixed(2));
                        totalClaimAmount = parseFloat((totalClaimAmount + halfDaily).toFixed(2));
                        plan.claimsMade = (plan.claimsMade || 0) + 1;
                        plan.daysCompleted = plan.claimsMade / 2;
                        
                        if (plan.claimsMade >= 200) {
                            plan.isActive = false;
                        }
                        plansUpdated++;
                    } else {
                        newlyActivePlansCount++;
                    }
                }
            });

            if (totalClaimAmount <= 0) {
                user.state = STATES.IDLE;
                await user.save();
                
                if (newlyActivePlansCount > 0) {
                    return ctx.reply("⏳ <b>Plan Processing...</b>\n\nYour plan was activated today. You can start claiming ROI from <b>tomorrow</b> using the codes provided by the Admin.", { parse_mode: 'HTML' });
                }
                return ctx.reply("❌ No eligible active plans found to claim profit from.");
            }

            user.walletBalance = parseFloat((user.walletBalance + totalClaimAmount).toFixed(2));
            user.totalEarned = parseFloat((user.totalEarned + totalClaimAmount).toFixed(2));
            user.state = STATES.IDLE;
            await user.save();

            await RoiClaim.create({
                userId: user.userID,
                codeId: roiCode._id,
                amountClaimed: totalClaimAmount
            });

            await Transaction.create({
                userId: user.userID,
                telegramId: user.telegramId,
                type: 'daily_income',
                amount: totalClaimAmount,
                description: `Trade Income Claimed (Code: ${inputCode})`,
                status: 'completed'
            });

            const msg = `✅ <b>Profit Claimed Successfully!</b>\n\n💰 Amount Credited: ${totalClaimAmount.toFixed(2)} USDT\n📊 Plans Processed: ${plansUpdated}\n👛 New Balance: ${user.walletBalance.toFixed(2)} USDT\n\n<i>Stay tuned for the next code to claim the remaining 50%!</i>`;
            return ctx.reply(msg, { parse_mode: 'HTML' });
        }

        if (user.state === STATES.ENTERING_SAVED_USDT) {
            user.bankDetails.usdtAddress = text;
            user.state = STATES.IDLE;
            await user.save();
            return ctx.reply("✅ <b>USDT (BEP20) Address saved successfully!</b>", { parse_mode: 'HTML' });
        }

        if (user.state === STATES.ENTERING_WITHDRAWAL_AMOUNT) {
            let inputAmount = parseFloat(text);
            if (isNaN(inputAmount) || inputAmount <= 0) {
                return ctx.reply(`❌ Invalid amount. Please enter a numeric value.`);
            }

            const method = user.sessionData?.method; // Should be USDT
            if (method !== 'USDT') {
                return ctx.reply("⚠️ Invalid withdrawal method.");
            }

            if (inputAmount < 10) {
                return ctx.reply(`❌ Minimum withdrawal is 10 USDT.`);
            }
            if (inputAmount > user.walletBalance) {
                return ctx.reply(`❌ Insufficient balance. Your balance is ${user.walletBalance.toFixed(2)} USDT.`);
            }

            const botFeeRate = 0.10;
            const adminFeeRate = 0.05;
            const botFee = parseFloat((inputAmount * botFeeRate).toFixed(2));
            const adminFee = parseFloat((inputAmount * adminFeeRate).toFixed(2));
            const taxAmount = parseFloat((botFee + adminFee).toFixed(2));
            const netAmount = parseFloat((inputAmount - taxAmount).toFixed(2));

            // Update Session Data with all details
            user.sessionData.wAmount = inputAmount;
            user.sessionData.taxAmount = taxAmount;
            user.sessionData.netAmount = netAmount;
            user.sessionData.botFee = botFee;
            user.sessionData.adminFee = adminFee;
            
            if (!user.bankDetails || !user.bankDetails.usdtAddress) {
                user.state = STATES.IDLE;
                user.markModified('sessionData');
                await user.save();
                return ctx.reply("⚠️ Please save your <b>USDT (BEP20) Address</b> first.", { 
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([[Markup.button.callback('🪙 Add USDT Address', 'EDIT_USDT')]])
                });
            }

            user.sessionData.usdtAddress = user.bankDetails.usdtAddress;
            user.state = STATES.CONFIRMING_WITHDRAWAL;
            user.markModified('sessionData');
            await user.save();

            const msg = `✅ <b>Withdrawal Confirmation (USDT)</b>\n\n💰 <b>Requested Amount:</b> ${inputAmount.toFixed(2)} USDT\n\n<b>Fees Breakdown:</b>\n🤖 Bot Fees (10%): ${botFee.toFixed(2)} USDT\n👤 Admin Fees (5%): ${adminFee.toFixed(2)} USDT\n━━━━━━━━━━━━━━━\n💵 <b>Net Payable:</b> ${netAmount.toFixed(2)} USDT\n\n<b>Payment Details:</b>\n🪙 USDT Address: <code>${user.bankDetails.usdtAddress}</code>\n🌐 Network: BEP20`;
            const btns = Markup.inlineKeyboard([
                [Markup.button.callback('✅ Confirm Withdrawal', 'CONFIRM_WITHDRAW')],
                [Markup.button.callback('❌ Cancel', 'CANCEL_WITHDRAW')]
            ]);
            ctx.reply(msg, { parse_mode: 'HTML', ...btns });
            return;
        }
    });

    bot.action('CONFIRM_WITHDRAW', async (ctx) => {
        await ctx.answerCbQuery();
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if (!user || user.state !== STATES.CONFIRMING_WITHDRAWAL) return;

        const { wAmount, taxAmount, netAmount, method, usdtAddress } = user.sessionData;
        
        if (!method || !wAmount) {
            user.state = STATES.IDLE;
            await user.save();
            return ctx.editMessageText("❌ Session expired. Please start the withdrawal process again.");
        }

        if (user.walletBalance < wAmount) {
            user.state = STATES.IDLE;
            user.sessionData = {};
            user.markModified('sessionData');
            await user.save();
            return ctx.editMessageText("❌ Insufficient wallet balance. Request cancelled.");
        }

        user.walletBalance = parseFloat((user.walletBalance - wAmount).toFixed(2));
        user.state = STATES.IDLE;
        user.sessionData = {};
        user.markModified('sessionData');
        await user.save();

        const withdrawal = await Withdrawal.create({
            userId: user.userID,
            telegramId: user.telegramId,
            amount: Number(wAmount),
            taxAmount: Number(taxAmount),
            netAmount: Number(netAmount),
            bankDetails: { method: 'USDT', address: usdtAddress },
            paymentMethod: method,
            usdtAddress: usdtAddress,
            status: 'pending'
        });

        await Transaction.create({
            userId: user.userID,
            telegramId: user.telegramId,
            type: 'withdrawal',
            amount: Number(wAmount),
            description: `Withdrawal Request (USDT) - Net ${Number(netAmount).toFixed(2)} USDT (20% Fee: ${Number(taxAmount).toFixed(2)} USDT)`,
            paymentMethod: method,
            status: 'pending'
        });

        ctx.editMessageText(`⏳ <b>Withdrawal request submitted!</b>\nAdmin will process it shortly.\nRef ID: WIT${withdrawal._id}`, { parse_mode: 'HTML' });

        // Notify Support Admin
        notifySupportAdmin(`💸 <b>New Withdrawal Request</b>\n\n👤 User: ${user.firstName} (ID: <code>${user.userID}</code>)\n💰 Amount: ${wAmount.toFixed(2)} USDT\n💵 Net: ${netAmount.toFixed(2)} USDT\n🪙 Address: <code>${usdtAddress}</code>\n\nPlease check the admin panel.`);
    });

    bot.action('CANCEL_WITHDRAW', async (ctx) => {
        await ctx.answerCbQuery();
        const user = await User.findOne({ telegramId: ctx.from.id.toString() });
        if(user) {
            user.state = STATES.IDLE;
            user.sessionData = {};
            user.markModified('sessionData');
            await user.save();
        }
        ctx.editMessageText("❌ Withdrawal request cancelled.");
    });
};
