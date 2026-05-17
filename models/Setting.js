const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema({
    depositDetails: {
        usdt: {
            address: { type: String, default: "" },
            network: { type: String, default: "BEP20" },
            qrCodeUrl: { type: String, default: "" } // Local path or URL
        }
    },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Setting", settingSchema);
