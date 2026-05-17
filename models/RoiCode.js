const mongoose = require("mongoose");

const roiCodeSchema = new mongoose.Schema({
    code: { type: String, unique: true, required: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true }
});

module.exports = mongoose.model("RoiCode", roiCodeSchema);
