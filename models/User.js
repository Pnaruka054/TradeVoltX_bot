const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    telegramId: { type: String, unique: true, required: true },
    username: { type: String },
    firstName: { type: String },
    lastName: { type: String },
    userID: { type: String, unique: true, required: true },
    referredBy: { type: String, default: null }, // userID of referrer
    walletBalance: { type: Number, default: 0 },
    bankDetails: {
        usdtAddress: { type: String, default: null },
        usdtNetwork: { type: String, default: "BEP20" }
    },
    activePlans: [{
        planAmount: { type: Number },
        dailyIncome: { type: Number },
        startDate: { type: Date },
        endDate: { type: Date },
        daysCompleted: { type: Number, default: 0 },
        claimsMade: { type: Number, default: 0 }, // 2 claims = 1 day
        isActive: { type: Boolean, default: true },
        lastIncomeAt: { type: Date }
    }],
    totalEarned: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    isBlocked: { type: Boolean, default: false },
    state: { type: String, default: "IDLE" },
    sessionData: { type: Object, default: {} }
});

module.exports = mongoose.model("User", userSchema);
