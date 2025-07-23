import mongoose from 'mongoose';

const PaymentLogSchema = new mongoose.Schema({
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true },
    request: { type: Object, required: true },
    response: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('PaymentLog', PaymentLogSchema);