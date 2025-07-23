import Cart from '../models/cart_model.js';
import response from '../utils/response.js';
import AppError from '../utils/AppError.js';
import mongoose from 'mongoose';
import axios from 'axios';
import order_controller from './order_controller.js';

const BOOK_SERVICE = process.env.BOOK_SERVICE || 'http://localhost:8000';

const cart_controller = {
    getCart: async (req, res, next) => {
        try {
            const userId = req.user.id;
            const userToken = req.headers.authorization;

            const cart = await Cart.findOne({ userId });
            if (!cart) {
                return response(res, 200, 'Giỏ hàng của bạn đang trống.', { cart: { userId, items: [] }, totalPrice: 0 });
            }

            // Lấy thông tin sách từ bookService
            const bookIds = cart.items.map(item => item.bookId.toString());
            let books = [];
            
            if (bookIds.length > 0) {
                const bookResponse = await axios.get(`${BOOK_SERVICE}/api/books/multiple?ids=${bookIds.join(',')}`, {
                    headers: { Authorization: userToken }
                });
                books = bookResponse.data.data.books;
            }

            // Tính tổng giá và kiểm tra tính khả dụng
            let totalPrice = 0;
            const updatedItems = cart.items.map(item => {
                const book = books.find(b => b._id === item.bookId.toString());
                if (!book || !book.availability || book.stockCount < item.quantity) {
                    throw new AppError(`Sách "${book?.title || item.bookId}" không khả dụng hoặc không đủ tồn kho.`, 400);
                }
                totalPrice += book.price * item.quantity;
                return {
                    ...item.toObject(),
                    title: book.title,
                    price: book.price,
                    primaryImage: book.images?.[0]?.path || 'default_image_url'
                };
            });

            return response(res, 200, 'Giỏ hàng được lấy thành công', { cart: { ...cart.toObject(), items: updatedItems }, totalPrice });
        } catch (error) {
            console.error('Lỗi lấy giỏ hàng:', error);
            next(error);
        }
    },


    addToCart: async (req, res, next) => {
        try {
            const userId = req.user.id;
            const { bookId, quantity } = req.body;
            const userToken = req.headers.authorization;

            if (!bookId || !quantity || quantity < 1) {
                throw new AppError('Dữ liệu đầu vào không hợp lệ: bookId và quantity là bắt buộc và quantity phải lớn hơn 0.', 400);
            }
            if (!mongoose.Types.ObjectId.isValid(bookId)) {
                throw new AppError('ID sách không hợp lệ.', 400);
            }

            const bookResponse = await axios.get(`${BOOK_SERVICE}/api/books/${bookId}`, {
                headers: { Authorization: userToken }
            });
            const book = bookResponse.data.data.book;
            if (!book) {
                throw new AppError('Sách không tồn tại.', 404);
            }
            if (!book.availability || book.stockCount < quantity) {
                throw new AppError(`Sách "${book.title}" hiện không đủ số lượng. Tồn kho còn lại: ${book.stockCount}.`, 400);
            }

            let cart = await Cart.findOne({ userId });
            if (!cart) {
                cart = new Cart({ userId, items: [] });
            }

            const itemIndex = cart.items.findIndex(item => item.bookId.toString() === bookId);
            if (itemIndex > -1) {
                const newQuantity = cart.items[itemIndex].quantity + quantity;
                if (newQuantity > book.stockCount) {
                    throw new AppError(`Số lượng sách "${book.title}" trong giỏ hàng không được vượt quá số lượng tồn kho. Tồn kho còn lại: ${book.stockCount}.`, 400);
                }
                cart.items[itemIndex].quantity = newQuantity;
                cart.items[itemIndex].price = book.price; // Cập nhật giá mới nhất
            } else {
                cart.items.push({
                    bookId,
                    quantity,
                    title: book.title,
                    price: book.price,
                    primaryImage: book.images?.[0]?.path || 'default_image_url'
                });
            }
            await cart.save();

            // Trả về cart với thông tin đã được cập nhật
            const updatedCart = {
                ...cart.toObject(),
                items: cart.items.map(item => ({
                    ...item.toObject(),
                    title: item.title,
                    price: item.price,
                    primaryImage: item.primaryImage
                }))
            };

            return response(res, 200, 'Thêm sách vào giỏ hàng thành công', { cart: updatedCart });
        } catch (error) {
            console.error('Lỗi thêm sách vào giỏ hàng:', error);
            next(error);
        }
    },


    updateCartItem: async (req, res, next) => {
        try {
            const userId = req.user.id;
            const { bookId, quantity } = req.body;
            const userToken = req.headers.authorization;

            if (!bookId || !quantity || quantity < 1) {
                throw new AppError('Dữ liệu đầu vào không hợp lệ: bookId và quantity là bắt buộc và quantity phải lớn hơn 0.', 400);
            }
            if (!mongoose.Types.ObjectId.isValid(bookId)) {
                throw new AppError('ID sách không hợp lệ.', 400);
            }

            const cart = await Cart.findOne({ userId });
            if (!cart) {
                throw new AppError('Giỏ hàng không tồn tại.', 404);
            }

            const itemIndex = cart.items.findIndex(item => item.bookId.toString() === bookId);
            if (itemIndex === -1) {
                throw new AppError('Sách không tìm thấy trong giỏ hàng.', 404);
            }

            const bookResponse = await axios.get(`${BOOK_SERVICE}/api/books/${bookId}`, {
                headers: { Authorization: userToken }
            });
            const book = bookResponse.data.data.book;
            if (!book) {
                throw new AppError('Sách không tồn tại.', 404);
            }
            if (quantity > book.stockCount) {
                throw new AppError(`Số lượng sách "${book.title}" không được vượt quá số lượng tồn kho. Tồn kho còn lại: ${book.stockCount}.`, 400);
            }

            cart.items[itemIndex].quantity = quantity;
            cart.items[itemIndex].price = book.price; // Cập nhật giá mới nhất
            await cart.save();

            // Trả về cart với thông tin đã được cập nhật
            const updatedCart = {
                ...cart.toObject(),
                items: cart.items.map(item => ({
                    ...item.toObject(),
                    title: item.title,
                    price: item.price,
                    primaryImage: item.primaryImage
                }))
            };

            return response(res, 200, 'Số lượng sách trong giỏ hàng được cập nhật thành công', { cart: updatedCart });
        } catch (error) {
            console.error('Lỗi cập nhật sách trong giỏ hàng:', error);
            next(error);
        }
    },
    removeFromCart: async (req, res, next) => {
        try {
            const userId = req.user.id;
            const { bookId } = req.body;

            if (!bookId) {
                throw new AppError('bookId là bắt buộc.', 400);
            }
            if (!mongoose.Types.ObjectId.isValid(bookId)) {
                throw new AppError('ID sách không hợp lệ.', 400);
            }

            const cart = await Cart.findOne({ userId });
            if (!cart) {
                throw new AppError('Giỏ hàng không tồn tại.', 404);
            }

            const initialLength = cart.items.length;
            cart.items = cart.items.filter(item => item.bookId.toString() !== bookId);
            if (cart.items.length === initialLength) {
                throw new AppError('Sách không tìm thấy trong giỏ hàng.', 404);
            }

            await cart.save();
            return response(res, 200, 'Xóa sách khỏi giỏ hàng thành công', { cart });
        } catch (error) {
            console.error('Lỗi xóa sách khỏi giỏ hàng:', error);
            next(error);
        }
    },


    clearCart: async (req, res, next) => {
        try {
            const userId = req.user.id;
            const cart = await Cart.findOne({ userId });

            if (!cart) {
                // Nếu chưa có giỏ hàng, coi như đã rỗng
                return response(res, 200, 'Giỏ hàng đã được xóa thành công', { cart: { userId, items: [] } });
            }
            cart.items = [];
            await cart.save();
            return response(res, 200, 'Giỏ hàng đã được xóa thành công', { cart });
        } catch (error) {
            console.error('Lỗi xóa giỏ hàng:', error);
            next(error);
        }
    }
}

export default cart_controller;