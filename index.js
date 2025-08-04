import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import orderRoutes from './routes/order_routes.js';
import cartRoutes from './routes/cart_routes.js';
import dbconnect from './config/db.js';
import cron from 'node-cron';
import Order from './models/order_model.js';
import Payment from './models/payment_model.js';
import { ORDER_STATUS, PAYMENT_STATUS, TRANSACTION_STATUS } from './utils/orderConstants.js';
import axios from 'axios';
import { sendOrderStatusEmail } from './utils/emailService.js';
import mongoose from 'mongoose';

dotenv.config();
const app = express();
const port = process.env.PORT || 8001;
const FRONTEND_URL = process.env.FRONTEND_URL;

app.use(cors({
    origin: FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(cookieParser());
app.use('/api/cart', cartRoutes);
app.use('/api/order', orderRoutes);
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
dbconnect();

// Cronjob tự động hủy đơn hàng PENDING chưa thanh toán sau 24h - chạy mỗi 10 phút
cron.schedule('*/10 * * * *', async () => {
    try {
        const now = new Date();
        console.log(`[CRON] Thời gian hiện tại: ${new Date().toISOString()}`);
        const expiredOrders = await Order.find({
            orderStatus: ORDER_STATUS.PENDING,
            paymentStatus: PAYMENT_STATUS.UNPAID,
            expiresAt: { $lt: now }
        });
        if (expiredOrders.length > 0) {
            console.log(`[CRON] Tìm thấy ${expiredOrders.length} đơn hàng quá hạn chưa thanh toán`);
            for (const order of expiredOrders) {
                console.log(`[CRON] Đơn hàng quá hạn: ${order.orderCode} - Expires: ${order.expiresAt.toISOString()}`);
            }
        }

        for (const order of expiredOrders) {
            const session = await mongoose.startSession();
            session.startTransaction();
            let transactionCommitted = false;

            try {
                // Trả lại tồn kho và giảm salesCount
                for (const item of order.items) {
                    try {
                        // Trả lại tồn kho
                        await axios.put(
                            `${process.env.BOOK_SERVICE_URL}/api/books/${item.bookId}/stock/cron`,
                            { quantity: item.quantity },
                            {
                                headers: {
                                    'Content-Type': 'application/json'
                                }
                            }
                        );

                        // Giảm salesCount
                        await axios.put(
                            `${process.env.BOOK_SERVICE_URL}/api/books/${item.bookId}/sales`,
                            { quantity: -item.quantity }, // Số âm để giảm
                            {
                                headers: {
                                    'Content-Type': 'application/json'
                                }
                            }
                        );

                        console.log(`[CRON] Đã cập nhật stock và sales cho book ${item.bookId}: +${item.quantity} stock, -${item.quantity} sales`);
                    } catch (err) {
                        console.error('Lỗi cập nhật stock/sales khi tự động hủy:', err);
                        console.error('Chi tiết lỗi:', err.response?.data || err.message);
                    }
                }

                // Cập nhật trạng thái đơn hàng
                order.orderStatus = ORDER_STATUS.CANCELED;
                order.paymentStatus = PAYMENT_STATUS.UNPAID;
                await order.save({ session });
                console.log(`[CRON] Đã cập nhật trạng thái đơn hàng: ${order.orderCode} -> ${order.orderStatus}`);
                // Hủy payment nếu có
                if (order.activePaymentId) {
                    const payment = await Payment.findById(order.activePaymentId).session(session);
                    if (payment) {
                        payment.transactionStatus = TRANSACTION_STATUS.FAILED;
                        await payment.save({ session });
                        console.log(`[CRON] Đã cập nhật payment: ${payment._id} -> ${payment.transactionStatus}`);
                    } else {
                        console.log(`[CRON] Không tìm thấy payment với ID: ${order.activePaymentId}`);
                    }
                } else {
                    console.log(`[CRON] Đơn hàng ${order.orderCode} không có activePaymentId`);
                }

                await session.commitTransaction();
                transactionCommitted = true;

                // Gửi email thông báo sau khi commit transaction
                if (order.userEmail && order.orderCode) {
                    try {
                        await sendOrderStatusEmail(order.userEmail, order, 'CANCELLED');
                        console.log(`[CRON] Đã gửi email hủy đơn hàng: ${order.orderCode} -> ${order.userEmail}`);
                    } catch (emailError) {
                        console.error('Lỗi gửi email tự động hủy:', emailError);
                    }
                } else {
                    console.log(`[CRON] Không thể gửi email - thiếu thông tin: userEmail=${order.userEmail}, orderCode=${order.orderCode}`);
                }

                console.log(`[CRON] Đã tự động hủy đơn quá hạn: ${order._id}`);
            } catch (error) {
                if (!transactionCommitted) {
                    await session.abortTransaction();
                }
                console.error(`[CRON] Lỗi khi tự động hủy đơn hàng ${order.orderCode}:`, error);
            } finally {
                session.endSession();
            }
        }
    } catch (err) {
        console.error('[CRON] Lỗi khi tự động hủy đơn quá hạn:', err);
    }
});