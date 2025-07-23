import mongoose from 'mongoose';
import { ORDER_STATUS, PAYMENT_STATUS, PAYMENT_METHOD } from '../utils/orderConstants.js';

const OrderItemSchema = new mongoose.Schema({
    bookId: { type: mongoose.Schema.Types.ObjectId, required: true },
    title: { type: String, required: true },
    originalPrice: { type: Number, required: false, min: 0 },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    primaryImage: { type: String, required: false, default: 'default_image_url' }
}, { _id: false });

const ShippingAddressSchema = new mongoose.Schema({
    address: { type: String, required: true },
    ward: { type: String, required: true },
    district: { type: String, required: true },
    city: { type: String, required: true }
}, { _id: false });

const OrderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userEmail: { type: String, trim: true },
    items: [OrderItemSchema],
    totalAmount: { type: Number, required: true, min: 0 },
    shippingFee: { type: Number, default: 0 },
    shippingAddress: ShippingAddressSchema,
    phoneNumber: { type: String, required: true, match: /^[0-9]{10,11}$/ },
    fullName: { type: String, required: true, minlength: 2, maxlength: 50 },
    orderStatus: { type: String, enum: Object.values(ORDER_STATUS), default: ORDER_STATUS.PENDING },
    paymentMethod: { type: String, enum: Object.values(PAYMENT_METHOD), required: true },
    paymentStatus: { type: String, enum: Object.values(PAYMENT_STATUS), default: PAYMENT_STATUS.UNPAID },
    paymentAttempts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }],
    activePaymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    orderCode: { type: String, unique: true, sparse: true },
    notes: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) },
    finalAmount: { type: Number, default: 0 },
    retryCount: { type: Number, default: 0 }, // Số lần retry thanh toán
});

OrderSchema.index({ userId: 1, orderStatus: 1, createdAt: -1 });

OrderSchema.pre('save', async function (next) {
    if (this.isNew && !this.orderCode) {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hour = date.getHours().toString().padStart(2, '0');
        const minute = date.getMinutes().toString().padStart(2, '0');
        const second = date.getSeconds().toString().padStart(2, '0');
        const random = Math.floor(1000 + Math.random() * 9000);
        this.orderCode = `OD${year}${month}${day}${hour}${minute}${second}${random}`;
    }
    this.updatedAt = Date.now();
    next();
});

const Order = mongoose.model('Order', OrderSchema);
export default Order;