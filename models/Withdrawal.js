const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    telegramId: { type: String, required: true },
    amount: { type: Number, required: true }, // gross
    taxAmount: { type: Number, required: true }, // 8%
    netAmount: { type: Number, required: true }, // after tax
    bankDetails: { type: Object, required: true },
    status: { 
        type: String, 
        enum: ["pending", "approved", "rejected", "completed"],
        default: "pending"
    },
    rejectionReason: { type: String, default: null },
    lgPayTransactionId: { type: String, default: null },
    adminNote: { type: String, default: null },
    paymentMethod: { type: String, enum: ["USDT"], default: "USDT" },
    usdtAddress: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Withdrawal", withdrawalSchema);
