const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    telegramId: { type: String },
    type: { 
        type: String, 
        enum: ["deposit", "withdrawal", "daily_income", "team_income"] 
    },
    amount: { type: Number, required: true },
    description: { type: String },
    status: { 
        type: String, 
        enum: ["pending", "approved", "rejected", "completed"],
        default: "pending"
    },
    relatedUserId: { type: String, default: null },
    level: { type: Number, default: null },
    rejectionReason: { type: String, default: null },
    txnId: { type: String, default: null }, // UTR or USDT Transaction Hash
    paymentMethod: { type: String, enum: ["USDT"], default: "USDT" },
    paymentScreenshot: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Transaction", transactionSchema);
