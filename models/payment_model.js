import mongoose from 'mongoose';
import { PAYMENT_METHOD, TRANSACTION_STATUS } from '../utils/orderConstants.js';

const PaymentSchema = new mongoose.Schema({
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    amount: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, enum: Object.values(PAYMENT_METHOD), required: true },
    transactionStatus: { type: String, enum: Object.values(TRANSACTION_STATUS), default: TRANSACTION_STATUS.PENDING },
    status: {
        type: String,
        enum: ['ACTIVE', 'CANCELED', 'COMPLETED'],
        default: 'ACTIVE'
    },
    gatewayTransactionId: { type: String },
    gatewayResponseCode: { type: String },
    gatewayMessage: { type: String },
    bankCode: { type: String },
    cardType: { type: String },
    payDate: { type: Date },
    rawResponse: { type: Object },
    vnp_TxnRef: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

PaymentSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

export default mongoose.model('Payment', PaymentSchema);