import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema({
    bookId: { type: mongoose.Schema.Types.ObjectId, required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    title: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    primaryImage: { type: String, default: 'default_image_url' }
});

const cartSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    items: [cartItemSchema],
}, {
    timestamps: true
});

cartSchema.index({ 'items.bookId': 1 });

const Cart = mongoose.model('Cart', cartSchema);
export default Cart;