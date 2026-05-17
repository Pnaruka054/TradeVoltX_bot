const mongoose = require("mongoose");

const roiClaimSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    codeId: { type: mongoose.Schema.Types.ObjectId, ref: "RoiCode", required: true },
    amountClaimed: { type: Number, required: true },
    claimedAt: { type: Date, default: Date.now }
});

// Compound index to prevent multiple claims of the same code by the same user
roiClaimSchema.index({ userId: 1, codeId: 1 }, { unique: true });

module.exports = mongoose.model("RoiClaim", roiClaimSchema);
