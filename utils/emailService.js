import axios from 'axios';
import { orderConfirmationEmail, orderStatusUpdateEmail } from './emailTemplates.js';

const USER_SERVICE = process.env.USER_SERVICE || 'http://localhost:5000';

// Gửi email thông báo đơn hàng tạo thành công (HTML)
export async function sendOrderConfirmationEmail(userEmail, order) {
    try {
        if (!userEmail) {
            console.error('Email không được cung cấp');
            return false;
        }
        const html = orderConfirmationEmail({ order });
        const response = await axios.post(`${USER_SERVICE}/api/email/order-confirmation`, {
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
        const html = orderStatusUpdateEmail({ order, newStatus });
        const response = await axios.post(`${USER_SERVICE}/api/email/order-status`, {
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

// Gửi email thông báo thanh toán (có thể nâng cấp sau)
export async function sendPaymentNotificationEmail(userEmail, orderCode, paymentStatus, amount, paymentMethod) {
    try {
        const response = await axios.post(`${USER_SERVICE}/api/email/payment-notification`, {
            to: userEmail,
            orderCode,
            paymentStatus,
            amount,
            paymentMethod
        });
        return response.data.success;
    } catch (error) {
        console.error('Lỗi gửi email thông báo thanh toán:', error.message);
        return false;
    }
} 