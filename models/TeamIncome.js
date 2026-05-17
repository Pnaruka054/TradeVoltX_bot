const mongoose = require("mongoose");

const teamIncomeSchema = new mongoose.Schema({
    earnerId: { type: String, required: true },
    sourceId: { type: String, required: true },
    level: { type: Number, required: true },
    incomeType: { 
        type: String, 
        enum: ["daily_percentage"],
        required: true
    },
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("TeamIncome", teamIncomeSchema);
