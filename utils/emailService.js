import axios from 'axios';
import { orderConfirmationEmail, orderStatusUpdateEmail } from './emailTemplates.js';
import dotenv from 'dotenv';
dotenv.config();

console.log("Main service url", process.env.MAIN_SERVICE_URL);
// Gửi email thông báo đơn hàng tạo thành công (HTML)
export async function sendOrderConfirmationEmail(userEmail, order) {
    try {
        if (!userEmail) {
            console.error('Email không được cung cấp');
            return false;
        }
        const bookServiceBaseUrl = process.env.BOOK_SERVICE_URL || 'http://localhost:8000';
        const html = orderConfirmationEmail({ order, bookServiceBaseUrl });
        const response = await axios.post(`${process.env.MAIN_SERVICE_URL}/api/email/order-confirmation`, {
            to: userEmail,
            subject: `Xác nhận đơn hàng #${order.orderCode}`,
            html
        });
        return response.data.success;
    } catch (error) {
        console.error('Lỗi gửi email thông báo đơn hàng:', error.response?.data || error.message);
        return false;
    }
}

// Gửi email thông báo cập nhật trạng thái đơn hàng (HTML)
export async function sendOrderStatusEmail(userEmail, order, newStatus) {
    try {
        const bookServiceBaseUrl = process.env.BOOK_SERVICE_URL || 'http://localhost:8000';
        const html = orderStatusUpdateEmail({ order, newStatus, bookServiceBaseUrl });
        const response = await axios.post(`${process.env.MAIN_SERVICE_URL}/api/email/order-status`, {
            to: userEmail,
            subject: `Đơn hàng #${order.orderCode} đã được cập nhật trạng thái: ${newStatus}`,
            html
        });
        return response.data.success;
    } catch (error) {
        console.error('Lỗi gửi email thông báo trạng thái:', error.message);
        return false;
    }
}

// Gửi email thông báo thanh toán online (thành công/thất bại)
export async function sendPaymentNotificationEmail(to, orderCode, status, amount, method, orderId = '', reason = '') {
    try {
        const orderLink = `${process.env.FRONTEND_URL}/orders/${orderId}`;
        const response = await axios.post(`${process.env.MAIN_SERVICE_URL}/api/email/payment-notification`, {
            to,
            orderCode,
            paymentStatus: status,
            amount,
            paymentMethod: method,
            orderId,
            reason,
            orderLink
        });
        return response.data.success;
    } catch (error) {
        console.error('Lỗi gửi email thông báo thanh toán:', error.response?.data || error.message);
        return false;
    }
}
