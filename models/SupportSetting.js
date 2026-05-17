const mongoose = require('mongoose');

const supportSettingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed },
    updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.model('SupportSetting', supportSettingSchema);
