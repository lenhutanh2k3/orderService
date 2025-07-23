// Email template for order confirmation and status update
const BOOK_SERVICE = process.env.BOOK_SERVICE || 'http://localhost:8000';

// Thêm hàm chuyển trạng thái và phương thức sang tiếng Việt
const STATUS_VI = {
  PENDING: 'Chờ xử lý',
  PROCESSING: 'Đang xử lý',
  SHIPPING: 'Đang giao hàng',
  SHIPPED: 'Đang giao hàng',
  DELIVERED: 'Đã giao',
  CANCELED: 'Đã hủy',
  CANCELLED: 'Đã hủy',
  RETURNED: 'Đã trả hàng',
  REFUNDED: 'Đã hoàn tiền',
  PAID: 'Đã thanh toán',
  UNPAID: 'Chưa thanh toán',
};
const PAYMENT_VI = {
  COD: 'Thanh toán khi nhận hàng (COD)',
  VNPAY: 'Thanh toán VNPay',
};
function getStatusVi(status) {
  if (!status) return '';
  return STATUS_VI[status.toUpperCase()] || status;
}
function getPaymentVi(method) {
  if (!method) return '';
  return PAYMENT_VI[method.toUpperCase()] || method;
}

export function orderItemsTable(items) {
  return `
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <thead>
        <tr style="background:#f5f5f5;">
          <th style="padding:8px;border:1px solid #eee;">Ảnh</th>
          <th style="padding:8px;border:1px solid #eee;">Tên sách</th>
          <th style="padding:8px;border:1px solid #eee;">Số lượng</th>
          <th style="padding:8px;border:1px solid #eee;">Giá</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(item => {
    const imagePath = (item.primaryImage || '').replace(/\\/g, '/');
    const imageUrl = `${BOOK_SERVICE}/${imagePath}`;
    console.log('[EMAIL TEMPLATE] Processing item:', JSON.stringify(item, null, 2));
    console.log('[EMAIL TEMPLATE] Generated image URL:', imageUrl);
    return `
            <tr>
              <td style="padding:8px;border:1px solid #eee;text-align:center;">
                <img src="${imageUrl}" alt="${item.title}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;"/>
              </td>
              <td style="padding:8px;border:1px solid #eee;">${item.title}</td>
              <td style="padding:8px;border:1px solid #eee;text-align:center;">${item.quantity}</td>
              <td style="padding:8px;border:1px solid #eee;text-align:right;">${item.price.toLocaleString('vi-VN')}₫</td>
            </tr>
          `;
  }).join('')}
      </tbody>
    </table>
    `;
}
export function orderInfoBlock(order) {
  return `
    <div style="margin:16px 0;">
      <strong>Mã đơn hàng:</strong> ${order.orderCode}<br/>
      <strong>Ngày đặt:</strong> ${new Date(order.createdAt).toLocaleString('vi-VN')}<br/>
      <strong>Trạng thái:</strong> ${getStatusVi(order.orderStatus)}<br/>
      <strong>Phương thức thanh toán:</strong> ${getPaymentVi(order.paymentMethod)}<br/>
      <strong>Địa chỉ nhận hàng:</strong> ${order.shippingAddress?.address}, ${order.shippingAddress?.ward}, ${order.shippingAddress?.district}, ${order.shippingAddress?.city}<br/>
      <strong>Người nhận:</strong> ${order.fullName} (${order.phoneNumber})
    </div>
    `;
}
export function orderTotalBlock(order) {
  return `
    <div style="margin:16px 0;font-size:16px;">
      <strong>Tổng tiền hàng:</strong> ${order.totalAmount.toLocaleString('vi-VN')}₫<br/>
      <strong>Phí vận chuyển:</strong> ${order.shippingFee.toLocaleString('vi-VN')}₫<br/>
      <strong style="color:#1976d2;">Tổng thanh toán:</strong> <span style="font-size:18px;color:#d32f2f;">${order.finalAmount.toLocaleString('vi-VN')}₫</span>
    </div>
    `;
}
export function orderConfirmationEmail({ order }) {
  console.log('[EMAIL TEMPLATE] orderConfirmationEmail input:', JSON.stringify(order, null, 2));
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;">
      <h2 style="color:#1976d2;">Xác nhận đặt hàng thành công!</h2>
      <p>Cảm ơn bạn đã đặt hàng tại <strong>Nhà Sách Online</strong>.</p>
      ${orderInfoBlock(order)}
      ${orderItemsTable(order.items)}
      ${orderTotalBlock(order)}
      <p style="margin-top:24px;">Nếu có bất kỳ thắc mắc nào, vui lòng liên hệ với chúng tôi qua email này hoặc hotline hỗ trợ.</p>
      <p style="color:#888;font-size:13px;">Đây là email tự động, vui lòng không trả lời email này.</p>
    </div>
    `;
}
export function orderStatusUpdateEmail({ order, newStatus }) {
  console.log('[EMAIL TEMPLATE] orderStatusUpdateEmail input:', JSON.stringify({ order, newStatus }, null, 2));
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;">
      <h2 style="color:#1976d2;">Cập nhật trạng thái đơn hàng</h2>
      <p>Đơn hàng <strong>${order.orderCode}</strong> của bạn vừa được cập nhật trạng thái: <span style="color:#d32f2f;font-weight:bold;">${getStatusVi(newStatus)}</span>.</p>
      ${orderInfoBlock(order)}
      ${orderItemsTable(order.items)}
      ${orderTotalBlock(order)}
      <p style="margin-top:24px;">Nếu có bất kỳ thắc mắc nào, vui lòng liên hệ với chúng tôi qua email này hoặc hotline hỗ trợ.</p>
      <p style="color:#888;font-size:13px;">Đây là email tự động, vui lòng không trả lời email này.</p>
    </div>
    `;
}