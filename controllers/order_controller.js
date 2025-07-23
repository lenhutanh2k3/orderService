import mongoose from 'mongoose';
import Order from '../models/order_model.js';
import Payment from '../models/payment_model.js';
import PaymentLog from '../models/payment_log_model.js';
import Cart from '../models/cart_model.js';
import AppError from '../utils/AppError.js';
import response from '../utils/response.js';
import { ORDER_STATUS, PAYMENT_STATUS, PAYMENT_METHOD, TRANSACTION_STATUS } from '../utils/orderConstants.js';
import crypto from 'crypto';
import moment from 'moment';
import querystring from 'qs';
import axios from 'axios';
import { sendOrderConfirmationEmail, sendOrderStatusEmail, sendPaymentNotificationEmail } from '../utils/emailService.js';

function sortObject(obj) {
    if (!obj || typeof obj !== 'object') {
        console.error('sortObject: Input is not an object', obj);
        return {};
    }
    let sorted = {};
    let str = Object.keys(obj)
        .map((key) => encodeURIComponent(key))
        .sort();
    str.forEach((key) => {
        sorted[key] = encodeURIComponent(obj[key]).replace(/%20/g, '+');
    });
    return sorted;
}

function verifyVnpaySignature(vnp_Params, hashSecret) {

    const params = { ...vnp_Params };
    let secureHash = params['vnp_SecureHash'];
    delete params['vnp_SecureHash'];
    delete params['vnp_SecureHashType'];
    const sortedParams = sortObject(params);
    const signData = querystring.stringify(sortedParams, { encode: false });
    console.log('[VNPay SIGNDATA][VERIFY]', signData);
    const hmac = crypto.createHmac('sha512', hashSecret);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
    return secureHash === signed;
}

const VNPAY_ERROR_CODES = {
    '00': 'Giao dịch thành công',
    '07': 'Trừ tiền thành công, giao dịch bị nghi ngờ (liên quan tới lừa đảo, giao dịch bất thường)',
    '09': 'Giao dịch không thành công do thẻ/tài khoản chưa đăng ký dịch vụ Internet Banking',
    '10': 'Giao dịch không thành công do xác thực thông tin thẻ/tài khoản không đúng',
    '11': 'Giao dịch không thành công do chưa nhập mã OTP',
    '12': 'Giao dịch không thành công do thẻ/tài khoản bị khóa',
    '13': 'Giao dịch không thành công do nhập sai mã OTP quá số lần quy định',
    '24': 'Giao dịch không thành công do người dùng hủy giao dịch',
    '51': 'Giao dịch không thành công do tài khoản không đủ số dư',
    '65': 'Giao dịch không thành công do vượt hạn mức thanh toán',
    '75': 'Ngân hàng thanh toán đang bảo trì',
    '99': 'Lỗi không xác định',
};

const order_controller = {
    createOrder: async (req, res, next) => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const userId = req.user.id;
            const userToken = req.headers.authorization;
            let { phoneNumber, fullName, paymentMethod, savedAddressId, shippingAddress, items, note, userEmail } = req.body;

            // Lấy email từ user nếu không có trong body
            if (!userEmail) {
                // Gọi API để lấy email của user
                try {
                    const userResponse = await axios.get(`${process.env.MAIN_SERVICE_URL}/api/users/profile`, {
                        headers: { Authorization: userToken },
                    });
                    userEmail = userResponse.data.data.user.email;
                } catch (error) {
                    console.error('Không thể lấy email user:', error.message);
                    userEmail = null;
                }
            }
            const cart = await Cart.findOne({ userId }).session(session);
            if (!cart || cart.items.length === 0) {
                throw new AppError('Giỏ hàng của bạn đang trống.', 400);
            }
            // Lọc chỉ các sản phẩm user đã chọn (FE gửi lên qua req.body.items)
            const selectedBookIds = (items || []).map(i => i.bookId?.toString());
            if (!selectedBookIds.length) {
                throw new AppError('Không có sản phẩm nào được chọn để đặt hàng.', 400);
            }
            // Lấy các item trong cart trùng với danh sách FE gửi lên
            const cartItems = cart.items.filter(item => selectedBookIds.includes(item.bookId.toString()));
            if (!cartItems.length) {
                throw new AppError('Không tìm thấy sản phẩm hợp lệ trong giỏ hàng.', 400);
            }
            const bookIds = cartItems.map((item) => item.bookId.toString());

            let finalShippingAddress,
                finalPhoneNumber = phoneNumber,
                finalFullName = fullName;
            if (savedAddressId) {
                const addressResponse = await axios.get(
                    `${process.env.MAIN_SERVICE_URL}/api/address/${savedAddressId}`,
                    {
                        headers: { Authorization: userToken },
                    }
                );
                const address = addressResponse.data.data.address;
                if (!address || address.userId !== userId) {
                    throw new AppError('Địa chỉ giao hàng không tồn tại hoặc không thuộc về bạn.', 400);
                }
                finalShippingAddress = { address: address.address, ward: address.ward, district: address.district, city: address.city };
                finalPhoneNumber = address.phoneNumber;
                finalFullName = address.fullName;
            } else if (shippingAddress) {
                console.log('Received shippingAddress in order:', JSON.stringify(shippingAddress, null, 2));
                // Validation cho shippingAddress từ request body
                if (!shippingAddress.address || !shippingAddress.ward || !shippingAddress.district || !shippingAddress.city) {
                    console.error('Missing shipping address fields:', {
                        address: !!shippingAddress.address,
                        ward: !!shippingAddress.ward,
                        district: !!shippingAddress.district,
                        city: !!shippingAddress.city
                    });
                    throw new AppError('Thiếu thông tin địa chỉ giao hàng (địa chỉ cụ thể, phường/xã, quận/huyện, tỉnh/thành phố)', 400);
                }
                finalShippingAddress = {
                    address: shippingAddress.address.trim(),
                    ward: shippingAddress.ward.trim(),
                    district: shippingAddress.district.trim(),
                    city: shippingAddress.city.trim()
                };
                console.log('Processed finalShippingAddress:', JSON.stringify(finalShippingAddress, null, 2));
            } else {
                throw new AppError('Vui lòng cung cấp địa chỉ giao hàng.', 400);
            }

            if (!finalPhoneNumber || !finalFullName) {
                throw new AppError('Vui lòng cung cấp đầy đủ số điện thoại và họ tên người nhận.', 400);
            }

            // Lấy thông tin sách từ bookService
            const bookResponse = await axios.get(
                `${process.env.BOOK_SERVICE_URL}/api/books/multiple?ids=${bookIds.join(',')}`,
                {
                    headers: { Authorization: userToken },
                }
            );
            const books = bookResponse.data.data.books;

            // Tính toán đơn hàng
            let totalAmount = 0;
            const orderItems = [];
            for (const item of cartItems) {
                const book = books.find((b) => b._id === item.bookId.toString());
                if (!book) {
                    throw new AppError(`Sản phẩm với ID ${item.bookId} không còn tồn tại.`, 404);
                }
                if (!book.availability || book.stockCount < item.quantity) {
                    throw new AppError(
                        `Sách "${book.title}" không đủ số lượng trong kho. Hiện có ${book.stockCount}.`,
                        400
                    );
                }
                orderItems.push({
                    bookId: item.bookId,
                    title: book.title,
                    originalPrice: book.price,
                    primaryImage: book.images?.[0]?.path || 'default_image_url',
                    price: book.price,
                    quantity: item.quantity
                });
                totalAmount += book.price * item.quantity;
            }

            const shippingFee = 30000; // Phí vận chuyển mặc định
            const finalAmount = totalAmount + shippingFee;

            // Tạo order
            const newOrder = new Order();

            // Set từng field một cách rõ ràng
            newOrder.userId = userId;
            newOrder.userEmail = userEmail;
            newOrder.items = orderItems;
            newOrder.totalAmount = totalAmount;
            newOrder.shippingFee = shippingFee;
            newOrder.shippingAddress = finalShippingAddress;
            newOrder.phoneNumber = finalPhoneNumber;
            newOrder.fullName = finalFullName;
            newOrder.paymentMethod = paymentMethod;
            newOrder.orderStatus = ORDER_STATUS.PENDING;
            newOrder.paymentStatus = PAYMENT_STATUS.UNPAID;
            newOrder.notes = note;
            newOrder.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            newOrder.finalAmount = finalAmount;
            newOrder.markModified('shippingAddress');

            // Validate trước khi save
            const validationError = newOrder.validateSync();
            if (validationError) {
                console.error('Order validation error:', validationError);
                throw new AppError(`Lỗi validation đơn hàng: ${validationError.message}`, 400);
            }
            await newOrder.save({ session });
            // Cập nhật salesCount cho từng sách trong đơn hàng
            for (const item of orderItems) {
                await axios.put(
                    `${process.env.BOOK_SERVICE_URL}/api/books/${item.bookId}/sales`,
                    { quantity: item.quantity },
                    { headers: { Authorization: userToken } }
                );
            }

            const newPayment = new Payment({
                orderId: newOrder._id,
                userId,
                amount: newOrder.finalAmount,
                paymentMethod,
                transactionStatus: TRANSACTION_STATUS.PENDING,
            });
            await newPayment.save({ session });

            newOrder.paymentAttempts = [newPayment._id];
            newOrder.activePaymentId = newPayment._id;
            await newOrder.save({ session });

            // Cập nhật tồn kho
            for (const item of cartItems) {
                await axios.put(
                    `${process.env.BOOK_SERVICE_URL}/api/books/${item.bookId}/stock`,
                    {
                        quantity: -item.quantity,
                        _version: books.find((b) => b._id === item.bookId.toString())._version,
                    },
                    {
                        headers: { Authorization: userToken },
                    }
                );
            }

            // Xóa các item đã đặt khỏi giỏ hàng, giữ lại các item chưa đặt
            const orderedBookIds = orderItems.map(item => item.bookId.toString());
            const userCart = await Cart.findOne({ userId }).session(session);
            if (userCart) {
                console.log('[ORDER] Các bookId đã đặt:', orderedBookIds);
                console.log('[ORDER] Giỏ hàng trước khi cập nhật:', userCart.items.map(i => i.bookId.toString()));
                userCart.items = userCart.items.filter(item => !orderedBookIds.includes(item.bookId.toString()));
                console.log('[ORDER] Giỏ hàng sau khi cập nhật:', userCart.items.map(i => i.bookId.toString()));
                if (userCart.items.length === 0) {
                    await Cart.deleteOne({ userId }).session(session);
                } else {
                    await userCart.save({ session });
                }
            }
            await session.commitTransaction();

            if (paymentMethod === PAYMENT_METHOD.COD) {
                console.log('[ORDER EMAIL] Gửi email xác nhận đơn hàng:', { userEmail, orderCode: newOrder.orderCode });
                if (userEmail) {
                    try {
                        await sendOrderConfirmationEmail(userEmail, newOrder);
                    } catch (emailError) {
                        console.error('Lỗi gửi email thông báo đơn hàng:', emailError.message);
                    }
                }
                return response(res, 201, 'Đặt hàng thành công. Đơn hàng sẽ được giao trong thời gian sớm nhất.', {
                    order: newOrder.toObject(),
                });
            } else if (paymentMethod === PAYMENT_METHOD.VNPAY) {
                console.log('[ORDER EMAIL] Gửi email xác nhận đơn hàng:', { userEmail, orderCode: newOrder.orderCode });
                if (userEmail) {
                    try {
                        await sendOrderConfirmationEmail(userEmail, newOrder);
                    } catch (emailError) {
                        console.error('Lỗi gửi email thông báo đơn hàng:', emailError.message);
                    }
                }
                return response(res, 201, 'Đơn hàng đã được tạo. Vui lòng tiến hành thanh toán VNPay.', {
                    orderId: newOrder._id.toString(),
                    orderCode: newOrder.orderCode,
                    paymentId: newPayment._id.toString(),
                    finalAmount: newOrder.finalAmount, // Trả về số tiền cuối cùng cần thanh toán
                });
            } else {
                throw new AppError('Phương thức thanh toán không hợp lệ.', 400);
            }
        } catch (error) {
            await session.abortTransaction();
            console.error('Lỗi khi tạo đơn hàng:', error);
            next(error);
        } finally {
            session.endSession();
        }
    },

    createPaymentUrl: async (req, res, next) => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const { orderId, paymentId, amount, bankCode, language } = req.body;
            const userId = req.user.id;
            const userEmail = req.user.email;

            if (!orderId || !paymentId || !amount) {
                throw new AppError('Thiếu thông tin: orderId, paymentId, hoặc amount.', 400);
            }

            const order = await Order.findById(orderId).session(session);
            const payment = await Payment.findById(paymentId).session(session);

            if (!order || order.userId.toString() !== userId) {
                throw new AppError('Đơn hàng không tồn tại hoặc không thuộc về bạn.', 400);
            }
            if (!payment || payment.orderId.toString() !== orderId || payment.userId.toString() !== userId) {
                throw new AppError('Giao dịch thanh toán không hợp lệ hoặc không thuộc về bạn.', 400);
            }
            if (order.paymentMethod !== PAYMENT_METHOD.VNPAY) {
                throw new AppError('Phương thức thanh toán của đơn hàng không phải VNPay.', 400);
            }
            if (order.orderStatus !== ORDER_STATUS.PENDING) {
                throw new AppError('Đơn hàng không ở trạng thái chờ thanh toán.', 400);
            }
            if (order.expiresAt < new Date()) {
                throw new AppError('Đơn hàng đã hết hạn. Vui lòng tạo đơn hàng mới.', 400);
            }
            // Thay vì lấy amount từ client, luôn dùng order.finalAmount để tạo vnp_Amount và so sánh.
            if (Math.abs(order.finalAmount - amount) > 0.01 || Math.abs(payment.amount - amount) > 0.01) {
                throw new AppError('Số tiền thanh toán không khớp với đơn hàng hoặc giao dịch.', 400);
            }
            if (
                order.paymentStatus === PAYMENT_STATUS.PAID ||
                payment.transactionStatus === TRANSACTION_STATUS.SUCCESS
            ) {
                throw new AppError('Đơn hàng này đã được thanh toán.', 400);
            }

            const vnp_TmnCode = process.env.VNP_TMNCODE;
            const vnp_HashSecret = process.env.VNP_HASHSECRET;
            const vnp_Url = process.env.VNP_URL;
            const vnp_ReturnUrl = process.env.VNP_RETURNURL;

            if (!vnp_TmnCode || !vnp_HashSecret || !vnp_Url || !vnp_ReturnUrl) {
                throw new AppError('Cấu hình VNPay chưa đầy đủ trên server.', 500);
            }

            // Thêm log để kiểm tra URL callback
            console.log('[VNPay CONFIG] vnp_ReturnUrl:', vnp_ReturnUrl);

            const ipAddr = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '127.0.0.1';
            const date = new Date();
            const createDate = moment(date).format('YYYYMMDDHHmmss');
            const vnp_TxnRef = payment._id.toString();
            const locale = language || 'vn';

            let vnp_Params = {
                vnp_Version: '2.1.0',
                vnp_Command: 'pay',
                vnp_TmnCode,
                vnp_Locale: locale,
                vnp_CurrCode: 'VND',
                vnp_TxnRef,
                vnp_OrderInfo: `Thanh toan don hang ${order.orderCode}`,
                vnp_OrderType: 'other',
                vnp_Amount: Math.round(order.finalAmount * 100),
                vnp_ReturnUrl,
                vnp_IpAddr: ipAddr.includes('::1') ? '127.0.0.1' : ipAddr.split(',')[0].trim(),
                vnp_CreateDate: createDate,
            };

            if (bankCode && bankCode.trim() !== '') {
                vnp_Params.vnp_BankCode = bankCode.trim();
            }

            vnp_Params = sortObject(vnp_Params);
            const signData = querystring.stringify(vnp_Params, { encode: false });
            console.log('[VNPay SIGNDATA][CREATE]', signData);
            const hmac = crypto.createHmac('sha512', vnp_HashSecret);
            const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
            vnp_Params.vnp_SecureHash = signed;

            const vnpUrl = `${vnp_Url}?${querystring.stringify(vnp_Params, { encode: false })}`;

            payment.vnp_TxnRef = vnp_TxnRef;
            await payment.save({ session });

            await session.commitTransaction();
            // Trước khi gọi sendPaymentNotificationEmail, kiểm tra đủ tham số
            let emailToSend = userEmail;
            if (!emailToSend) {
                try {
                    const userResponse = await axios.get(`${process.env.MAIN_SERVICE_URL}/api/users/${order.userId}`, {
                        headers: { Authorization: req.headers.authorization },
                    });
                    emailToSend = userResponse.data.data.user.email;
                } catch (err) {
                    console.error('Không thể lấy email user khi gửi email thanh toán:', err.message);
                    emailToSend = null;
                }
            }

            console.log('[VNPay] Tạo URL thanh toán cho order', order._id, 'vnp_Amount:', vnp_Params.vnp_Amount);
            return response(res, 200, 'Tạo URL thanh toán VNPay thành công', { vnpUrl });
        } catch (error) {
            await session.abortTransaction();
            console.error('Lỗi tạo URL thanh toán VNPay:', error);
            next(error);
        } finally {
            session.endSession();
        }
    },

    // ===== START REFACTORED VNPay PROCESSING LOGIC =====

    _processVnpayCallback: async (vnp_Params, req, session) => {
        // 1. Validate input and get payment/order
        if (!vnp_Params || typeof vnp_Params !== 'object') {
            throw new AppError('Dữ liệu VNPay không hợp lệ.', 400);
        }
        const paymentId = vnp_Params['vnp_TxnRef'];
        if (!paymentId) {
            throw new AppError('Thiếu mã giao dịch (vnp_TxnRef).', 400);
        }

        console.log(`[VNPay Callback] Bắt đầu xử lý cho paymentId: ${paymentId}`);

        const payment = await Payment.findById(paymentId).session(session);
        if (!payment) {
            return { RspCode: '01', Message: 'Order not found' };
        }

        const order = await Order.findById(payment.orderId).session(session);
        if (!order) {
            return { RspCode: '01', Message: 'Order not found' };
        }

        console.log(`[VNPay Callback] Found Order: ${order.orderCode}, Payment: ${payment._id}`);

        // 2. Check if already processed
        if (payment.transactionStatus === TRANSACTION_STATUS.SUCCESS) {
            console.log('[VNPay Callback] Giao dịch đã được xử lý thành công trước đó.');
            return {
                RspCode: '02',
                Message: 'Order already confirmed',
                redirect: `${process.env.FRONTEND_URL}/order-success?orderId=${order._id}&method=${PAYMENT_METHOD.VNPAY}&status=already_paid`
            };
        }

        // 3. Verify signature
        if (!verifyVnpaySignature(vnp_Params, process.env.VNP_HASHSECRET)) {
            console.error('[VNPay Callback] Chữ ký không hợp lệ.');
            payment.transactionStatus = TRANSACTION_STATUS.FAILED;
            payment.gatewayMessage = 'Chữ ký không hợp lệ. Giao dịch có thể bị giả mạo.';
            await payment.save({ session });
            // No need to send email here as it might be a fraudulent attempt

            return {
                RspCode: '97',
                Message: 'Checksum failed',
                redirect: `${process.env.FRONTEND_URL}/payment/error?message=${encodeURIComponent('Chữ ký giao dịch không hợp lệ.')}`
            };
        }

        console.log('[VNPay Callback] Chữ ký hợp lệ.');

        // 4. Log the callback
        await PaymentLog.create([{
            paymentId,
            request: vnp_Params,
            response: { secureHash: vnp_Params['vnp_SecureHash'] },
        }], { session });

        // 5. Parse VNPay response
        const receivedAmount = parseInt(vnp_Params['vnp_Amount']) / 100;
        const vnp_ResponseCode = vnp_Params['vnp_ResponseCode'];
        const vnp_TransactionStatus = vnp_Params['vnp_TransactionStatus'];
        const payDate = vnp_Params['vnp_PayDate'] ? moment(vnp_Params['vnp_PayDate'], 'YYYYMMDDHHmmss').toDate() : new Date();

        // 6. Check for business logic errors (Expired, Amount Mismatch)
        if (order.expiresAt < payDate) {
            console.error(`[VNPay Callback] Đơn hàng hết hạn. Expires: ${order.expiresAt}, PayDate: ${payDate}`);
            order.orderStatus = ORDER_STATUS.CANCELED;
            payment.transactionStatus = TRANSACTION_STATUS.FAILED;
            payment.gatewayMessage = 'Giao dịch thất bại do đơn hàng đã hết hạn.';
            // It's crucial to restore stock for expired orders
            for (const item of order.items) {
                try {
                    await axios.put(
                        `${process.env.BOOK_SERVICE_URL}/api/books/${item.bookId}/stock`,
                        { quantity: item.quantity },
                        { headers: { Authorization: req.headers.authorization } } // Assuming token is available in req
                    );
                } catch (stockError) {
                    console.error(`Lỗi trả lại stock cho sách ${item.bookId}:`, stockError);
                }
            }
            await Promise.all([order.save({ session }), payment.save({ session })]);
            return { RspCode: '99', Message: 'Transaction timeout', redirect: `${process.env.FRONTEND_URL}/payment/failure?orderId=${order._id}&code=timeout` };
        }

        if (Math.abs(receivedAmount - order.finalAmount) > 0.01) {
            console.error(`[VNPay Callback] Số tiền không khớp. Received: ${receivedAmount}, Expected: ${order.finalAmount}`);
            payment.transactionStatus = TRANSACTION_STATUS.FAILED;
            payment.gatewayMessage = `Số tiền không khớp. Ghi nhận ${receivedAmount} VND, mong đợi ${order.finalAmount} VND.`;
            await payment.save({ session });
            return {
                RspCode: '04',
                Message: 'Amount invalid',
                redirect: `${process.env.FRONTEND_URL}/payment/failure?orderId=${order._id}&code=amount_mismatch`
            };
        }

        // 7. Process Final Status (Success or Failure)
        const isSuccess = vnp_ResponseCode === '00' && vnp_TransactionStatus === '00';

        payment.gatewayTransactionId = vnp_Params['vnp_TransactionNo'];
        payment.gatewayResponseCode = vnp_ResponseCode;
        payment.gatewayMessage = VNPAY_ERROR_CODES[vnp_ResponseCode] || vnp_Params['vnp_Message'] || 'Lỗi không xác định.';
        payment.bankCode = vnp_Params['vnp_BankCode'];
        payment.cardType = vnp_Params['vnp_CardType'];
        payment.payDate = payDate;
        payment.rawResponse = vnp_Params;

        if (isSuccess) {
            console.log(`[VNPay Callback] Xử lý thanh toán THÀNH CÔNG cho đơn hàng ${order.orderCode}.`);
            payment.transactionStatus = TRANSACTION_STATUS.SUCCESS;
            order.paymentStatus = PAYMENT_STATUS.PAID;
            order.orderStatus = ORDER_STATUS.PROCESSING;

            try {
                await sendPaymentNotificationEmail(
                    order.userEmail,
                    order.orderCode,
                    'PAID',
                    order.finalAmount,
                    'VNPAY'
                );
            } catch (emailError) {
                console.error('Lỗi gửi email thông báo thành công:', emailError);
            }

            await Promise.all([order.save({ session }), payment.save({ session })]);

            return {
                RspCode: '00',
                Message: 'Success',
                redirect: `${process.env.FRONTEND_URL}/order-success?orderId=${order._id}&method=${PAYMENT_METHOD.VNPAY}`
            };

        } else {
            console.log(`[VNPay Callback] Xử lý thanh toán THẤT BẠI cho đơn hàng ${order.orderCode}. Lý do: ${payment.gatewayMessage}`);
            payment.transactionStatus = TRANSACTION_STATUS.FAILED;
            order.paymentStatus = PAYMENT_STATUS.UNPAID; // Keep as UNPAID
            order.orderStatus = ORDER_STATUS.PENDING; // Keep as PENDING for user to retry (or for cleanup)

            try {
                await sendPaymentNotificationEmail(
                    order.userEmail,
                    order.orderCode,
                    'FAILED',
                    order.finalAmount,
                    'VNPAY'
                );
            } catch (emailError) {
                console.error('Lỗi gửi email thông báo thất bại:', emailError);
            }

            await Promise.all([order.save({ session }), payment.save({ session })]);

            return {
                RspCode: vnp_ResponseCode, // Return the actual error code from VNPay
                Message: 'Transaction failed',
                redirect: `${process.env.FRONTEND_URL}/payment/failure?orderId=${order._id}&code=${vnp_ResponseCode}&message=${encodeURIComponent(payment.gatewayMessage)}`
            };
        }
    },

    // ===== END REFACTORED VNPay PROCESSING LOGIC =====

    vnpayReturn: async (req, res, next) => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            console.log('[VNPay RETURN] Received callback:', req.query);
            const result = await order_controller._processVnpayCallback(req.query, req, session);
            await session.commitTransaction();

            console.log(`[VNPay RETURN] Redirecting to: ${result.redirect}`);
            return res.redirect(result.redirect);

        } catch (error) {
            await session.abortTransaction();
            console.error('[VNPay RETURN] Lỗi xử lý kết quả VNPay:', error);
            // Redirect to a generic error page in case of unexpected errors
            return res.redirect(`${process.env.FRONTEND_URL}/payment/error?message=${encodeURIComponent('Đã xảy ra lỗi không mong muốn.')}`);
        } finally {
            session.endSession();
        }
    },

    vnpayIpn: async (req, res, next) => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            console.log('[VNPay IPN] Received callback:', req.query);
            const result = await order_controller._processVnpayCallback(req.query, req, session);
            await session.commitTransaction();

            console.log(`[VNPay IPN] Responding with: RspCode=${result.RspCode}, Message=${result.Message}`);
            return res.status(200).json({ RspCode: result.RspCode, Message: result.Message });

        } catch (error) {
            await session.abortTransaction();
            console.error('[VNPay IPN] Lỗi xử lý IPN VNPay:', error);
            // According to VNPay docs, always return a 200 OK response for IPN
            return res.status(200).json({ RspCode: '99', Message: 'Internal Server Error' });
        } finally {
            session.endSession();
        }
    },

    retryPayment: async (req, res, next) => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const { id: orderId } = req.params;
            const userId = req.user.id;
            const userEmail = req.user.email;

            // 1. Find and validate the order
            const order = await Order.findById(orderId).session(session);

            if (!order) {
                throw new AppError('Đơn hàng không tồn tại.', 404);
            }
            if (order.userId.toString() !== userId) {
                throw new AppError('Bạn không có quyền thực hiện hành động này.', 403);
            }
            if (order.paymentMethod !== PAYMENT_METHOD.VNPAY) {
                throw new AppError('Chức năng này chỉ dành cho đơn hàng thanh toán qua VNPay.', 400);
            }
            if (order.orderStatus !== ORDER_STATUS.PENDING) {
                throw new AppError('Chỉ có thể thanh toán lại cho đơn hàng ở trạng thái "Chờ xử lý".', 400);
            }
            // Kiểm tra hết hạn
            if (order.expiresAt < new Date()) {
                // Hủy đơn hàng nếu quá hạn
                order.orderStatus = ORDER_STATUS.CANCELED;
                order.paymentStatus = PAYMENT_STATUS.UNPAID;
                await order.save({ session });
                return response(res, 400, 'Đơn hàng đã hết hạn và đã bị hủy. Vui lòng tạo đơn hàng mới.');
            }
            if (order.retryCount >= 2) { // Đã retry 2 lần, lần này là lần thứ 3
                await session.abortTransaction();
                return res.status(409).json({
                    message: 'Bạn đã thử lại thanh toán 3 lần không thành công. Bạn có muốn hủy đơn hàng này không?',
                    shouldConfirmCancel: true
                });
            }
            // Tăng retryCount
            order.retryCount += 1;

            // 2. Cancel the old payment attempt
            if (order.activePaymentId) {
                await Payment.updateOne(
                    { _id: order.activePaymentId },
                    { $set: { status: 'CANCELED', transactionStatus: 'FAILED', gatewayMessage: 'Bị hủy bởi lần thử thanh toán mới.' } },
                    { session }
                );
            }

            // 3. Create a new payment attempt
            const newPayment = new Payment({
                orderId: order._id,
                userId,
                amount: order.finalAmount, // Always use the amount from the order
                paymentMethod: PAYMENT_METHOD.VNPAY,
                status: 'ACTIVE',
                transactionStatus: TRANSACTION_STATUS.PENDING,
            });
            await newPayment.save({ session });

            // 4. Update the order with the new payment attempt
            order.paymentAttempts.push(newPayment._id);
            order.activePaymentId = newPayment._id;
            // Ensure payment status is reset correctly
            order.paymentStatus = PAYMENT_STATUS.UNPAID;
            await order.save({ session });

            // 5. Generate a new VNPay URL
            const vnp_TmnCode = process.env.VNP_TMNCODE;
            const vnp_HashSecret = process.env.VNP_HASHSECRET;
            const vnp_Url = process.env.VNP_URL;
            const vnp_ReturnUrl = process.env.VNP_RETURNURL;

            if (!vnp_TmnCode || !vnp_HashSecret || !vnp_Url || !vnp_ReturnUrl) {
                throw new AppError('Cấu hình VNPay chưa đầy đủ trên server.', 500);
            }

            const ipAddr = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '127.0.0.1';
            const createDate = moment().format('YYYYMMDDHHmmss');
            const vnp_TxnRef = newPayment._id.toString();

            let vnp_Params = {
                vnp_Version: '2.1.0',
                vnp_Command: 'pay',
                vnp_TmnCode,
                vnp_Locale: 'vn',
                vnp_CurrCode: 'VND',
                vnp_TxnRef,
                vnp_OrderInfo: `Thanh toan lai cho don hang ${order.orderCode}`,
                vnp_OrderType: 'other',
                vnp_Amount: Math.round(order.finalAmount * 100),
                vnp_ReturnUrl,
                vnp_IpAddr: ipAddr.includes('::1') ? '127.0.0.1' : ipAddr.split(',')[0].trim(),
                vnp_CreateDate: createDate,
            };

            vnp_Params = sortObject(vnp_Params);
            const signData = querystring.stringify(vnp_Params, { encode: false });
            const hmac = crypto.createHmac('sha512', vnp_HashSecret);
            const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
            vnp_Params.vnp_SecureHash = signed;

            const vnpUrl = `${vnp_Url}?${querystring.stringify(vnp_Params, { encode: false })}`;

            // Commit transaction and return URL
            await session.commitTransaction();

            return response(res, 200, 'Tạo URL thanh toán lại thành công.', { vnpUrl });

        } catch (error) {
            await session.abortTransaction();
            console.error('Lỗi khi thử lại thanh toán:', error);
            next(error);
        } finally {
            session.endSession();
        }
    },

    updateOrderStatus: async (req, res, next) => {
        const session = await mongoose.startSession();
        session.startTransaction();
        let transactionCommitted = false;

        try {
            const { id } = req.params;
            const { newStatus } = req.body;
            const userToken = req.headers.authorization;

            if (!newStatus || !Object.values(ORDER_STATUS).includes(newStatus)) {
                throw new AppError('Trạng thái đơn hàng không hợp lệ.', 400);
            }

            const order = await Order.findById(id).session(session);
            if (!order) throw new AppError('Không tìm thấy đơn hàng.', 404);

            // Lấy email của user
            let userEmail = order.userEmail;
            if (!userEmail) {
                try {
                    const userResponse = await axios.get(`${process.env.MAIN_SERVICE_URL}/api/users/${order.userId}`, {
                        headers: { Authorization: userToken },
                    });
                    userEmail = userResponse.data.data.user.email;
                } catch (err) {
                    console.error('Không thể lấy email user:', err.message);
                    userEmail = null;
                }
            }
            if (!userEmail) {
                throw new AppError('Không tìm thấy email người dùng để gửi thông báo.', 404);
            }

            const currentStatus = order.orderStatus;
            if (currentStatus === ORDER_STATUS.DELIVERED && newStatus !== ORDER_STATUS.RETURNED) {
                throw new AppError(`Không thể thay đổi trạng thái từ "${ORDER_STATUS.DELIVERED}".`, 400);
            }
            if (currentStatus === ORDER_STATUS.CANCELED) {
                throw new AppError(`Đơn hàng đã bị hủy, không thể thay đổi trạng thái.`, 400);
            }
            if (order.paymentStatus === PAYMENT_STATUS.PAID && newStatus === ORDER_STATUS.PENDING) {
                throw new AppError('Không thể chuyển đơn hàng đã thanh toán về trạng thái chờ.', 400);
            }

            order.orderStatus = newStatus;
            let payment = order.activePaymentId ? await Payment.findById(order.activePaymentId).session(session) : null;

            // Gửi email thông báo cho tất cả các trạng thái
            try {
                await sendOrderStatusEmail(userEmail, order, newStatus);
            } catch (emailError) {
                console.error('Lỗi gửi email thông báo trạng thái:', emailError);
            }

            if (order.paymentMethod === PAYMENT_METHOD.COD && newStatus === ORDER_STATUS.DELIVERED) {
                order.paymentStatus = PAYMENT_STATUS.PAID;
                if (payment) {
                    payment.transactionStatus = TRANSACTION_STATUS.SUCCESS;
                    await payment.save({ session });
                }

            } else if (newStatus === ORDER_STATUS.REFUNDED) {
                if (order.paymentStatus !== PAYMENT_STATUS.PAID) {
                    throw new AppError('Không thể hoàn tiền đơn hàng chưa được thanh toán.', 400);
                }
                if (order.paymentMethod === PAYMENT_METHOD.VNPAY) {
                    const refundResponse = await axios.post(
                        `${process.env.VNP_API}/refund`,
                        {
                            vnp_TxnRef: payment.vnp_TxnRef,
                            vnp_Amount: order.finalAmount * 100, // Sử dụng finalAmount thay vì totalAmount
                            vnp_TransactionDate: payment.payDate,
                            vnp_TmnCode: process.env.VNP_TMNCODE,
                            vnp_HashSecret: process.env.VNP_HASHSECRET,
                        }
                    );
                    if (refundResponse.data.vnp_ResponseCode !== '00') {
                        throw new AppError('Hoàn tiền VNPay thất bại.', 400);
                    }
                }
                order.paymentStatus = PAYMENT_STATUS.REFUNDED;
                if (payment) {
                    payment.transactionStatus = TRANSACTION_STATUS.REFUNDED;
                    await payment.save({ session });
                }
                for (const item of order.items) {
                    try {
                        await axios.put(
                            `${process.env.BOOK_SERVICE_URL}/api/books/${item.bookId}/stock`,
                            {
                                quantity: item.quantity,
                            },
                            {
                                headers: { Authorization: userToken },
                            }
                        );
                    } catch (stockError) {
                        console.error('Lỗi cập nhật stock:', stockError);
                    }
                }

            } else if (newStatus === ORDER_STATUS.CANCELED) {
                if (currentStatus !== ORDER_STATUS.CANCELED && order.paymentStatus !== PAYMENT_STATUS.PAID) {
                    for (const item of order.items) {
                        try {
                            await axios.put(
                                `${process.env.BOOK_SERVICE_URL}/api/books/${item.bookId}/stock`,
                                {
                                    quantity: item.quantity,
                                },
                                {
                                    headers: { Authorization: userToken },
                                }
                            );
                        } catch (stockError) {
                            console.error('Lỗi cập nhật stock:', stockError);
                        }
                    }
                }
                if (order.paymentStatus !== PAYMENT_STATUS.PAID) {
                    order.paymentStatus = PAYMENT_STATUS.UNPAID;
                    if (payment) {
                        payment.transactionStatus = TRANSACTION_STATUS.FAILED;
                        await payment.save({ session });
                    }
                }

            }

            await order.save({ session });
            await session.commitTransaction();
            transactionCommitted = true;
            return response(res, 200, `Trạng thái đơn hàng đã được cập nhật thành "${newStatus}"`, { order });
        } catch (error) {
            if (!transactionCommitted) {
                await session.abortTransaction();
            }
            console.error('Lỗi cập nhật trạng thái đơn hàng:', error);
            next(error);
        } finally {
            session.endSession();
        }
    },

    getOrdersByUser: async (req, res, next) => {
        try {
            const userId = req.user.id;
            const { page = 1, limit = 10, status } = req.query;
            let query = { userId };
            if (status && Object.values(ORDER_STATUS).includes(status)) {
                query.orderStatus = status;
            }
            const skip = (parseInt(page) - 1) * parseInt(limit);
            const [orders, total] = await Promise.all([
                Order.find(query)
                    .populate('activePaymentId')
                    .populate('paymentAttempts')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(parseInt(limit))
                    .lean(),
                Order.countDocuments(query),
            ]);
            return response(res, 200, 'Lấy danh sách đơn hàng thành công', {
                orders,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / parseInt(limit)),
                    totalItems: total,
                    itemsPerPage: parseInt(limit),
                },
            });
        } catch (error) {
            console.error('Lỗi lấy danh sách đơn hàng:', error);
            next(error);
        }
    },

    getOrderById: async (req, res, next) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const order = await Order.findById(id)
                .populate('activePaymentId')
                .populate('paymentAttempts')
                .lean();
            if (!order) throw new AppError('Không tìm thấy đơn hàng.', 404);
            if (order.userId.toString() !== userId && req.user.role !== 'admin') {
                throw new AppError('Bạn không có quyền xem đơn hàng này.', 403);
            }
            return response(res, 200, 'Lấy chi tiết đơn hàng thành công', { order });
        } catch (error) {
            console.error('Lỗi lấy đơn hàng theo ID:', error);
            next(error);
        }
    },

    getAllOrders: async (req, res, next) => {
        try {
            const { page = 1, limit = 10, status, userId, search } = req.query;
            let query = {};
            if (status && Object.values(ORDER_STATUS).includes(status)) query.orderStatus = status;
            if (userId) {
                if (!mongoose.Types.ObjectId.isValid(userId)) throw new AppError('ID người dùng không hợp lệ.', 400);
                query.userId = userId;
            }
            if (search) {
                query.$or = [
                    { 'items.title': { $regex: search, $options: 'i' } },
                    { orderCode: { $regex: search, $options: 'i' } },
                    { _id: mongoose.Types.ObjectId.isValid(search) ? search : null },
                ].filter(Boolean);
            }
            const skip = (parseInt(page) - 1) * parseInt(limit);
            const [orders, total] = await Promise.all([
                Order.find(query)
                    .populate('activePaymentId')
                    .populate('paymentAttempts')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(parseInt(limit))
                    .lean(),
                Order.countDocuments(query),
            ]);
            return response(res, 200, 'Lấy tất cả đơn hàng thành công', {
                orders,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / parseInt(limit)),
                    totalItems: total,
                    itemsPerPage: parseInt(limit),
                },
            });
        } catch (error) {
            console.error('Lỗi lấy tất cả đơn hàng:', error);
            next(error);
        }
    },

    cancelOrder: async (req, res, next) => {
        const session = await mongoose.startSession();
        session.startTransaction();
        let transactionCommitted = false;

        try {
            const { id } = req.params;
            const userId = req.user.id;
            const userRole = req.user.role;
            const userEmail = req.user.email;
            const userToken = req.headers.authorization;

            const order = await Order.findById(id).session(session);
            if (!order) throw new AppError('Không tìm thấy đơn hàng.', 404);
            if (order.userId.toString() !== userId && userRole !== 'admin') {
                throw new AppError('Bạn không có quyền hủy đơn hàng này.', 403);
            }
            if (
                order.orderStatus === ORDER_STATUS.SHIPPED ||
                order.orderStatus === ORDER_STATUS.DELIVERED ||
                order.orderStatus === ORDER_STATUS.CANCELED
            ) {
                throw new AppError(`Không thể hủy đơn hàng ở trạng thái "${order.orderStatus}".`, 400);
            }
            if (order.paymentStatus === PAYMENT_STATUS.PAID) {
                throw new AppError('Không thể hủy đơn hàng đã thanh toán.', 400);
            }

            for (const item of order.items) {
                try {
                    await axios.put(
                        `${process.env.BOOK_SERVICE_URL}/api/books/${item.bookId}/stock`,
                        {
                            quantity: item.quantity,
                        },
                        {
                            headers: { Authorization: userToken },
                        }
                    );
                } catch (stockError) {
                    console.error('Lỗi cập nhật stock:', stockError);
                }
            }
            order.orderStatus = ORDER_STATUS.CANCELED;
            order.paymentStatus = PAYMENT_STATUS.UNPAID;
            await order.save({ session });

            if (order.payment) {
                const payment = await Payment.findById(order.payment).session(session);
                if (payment) {
                    payment.transactionStatus = TRANSACTION_STATUS.FAILED;
                    await payment.save({ session });
                }
            }

            await session.commitTransaction();
            transactionCommitted = true;

            // Đảm bảo luôn có userEmail và orderCode khi gửi email
            let emailToSend = order.userEmail;
            if (!emailToSend) {
                try {
                    const userResponse = await axios.get(`${process.env.MAIN_SERVICE_URL}/api/users/${order.userId}`, {
                        headers: { Authorization: userToken },
                    });
                    emailToSend = userResponse.data.data.user.email;
                } catch (err) {
                    console.error('Không thể lấy email user khi hủy đơn hàng:', err.message);
                    emailToSend = null;
                }
            }
            if (emailToSend && order.orderCode) {
                try {
                    await sendOrderStatusEmail(emailToSend, order, 'CANCELLED');
                } catch (emailError) {
                    console.error('Lỗi gửi email thông báo:', emailError);
                }
            } else {
                console.warn('[EMAIL WARNING] Thiếu thông tin khi gửi email trạng thái hủy đơn hàng:', {
                    emailToSend,
                    orderCode: order.orderCode
                });
            }

            return response(res, 200, 'Đơn hàng đã được hủy thành công', { order });
        } catch (error) {
            if (!transactionCommitted) {
                await session.abortTransaction();
            }
            console.error('Lỗi hủy đơn hàng:', error);
            next(error);
        } finally {
            session.endSession();
        }
    },

    previewOrder: async (req, res, next) => {
        try {
            const userId = req.user?.id;
            const userToken = req.headers.authorization;

            if (!userId) {
                return response(res, 401, 'Vui lòng đăng nhập để xem trước đơn hàng.');
            }

            const cart = await Cart.findOne({ userId });
            if (!cart || cart.items.length === 0) {
                return response(res, 400, 'Giỏ hàng của bạn đang trống.');
            }

            // Lọc chỉ các sản phẩm user đã chọn (nếu FE truyền lên)
            let cartItems = cart.items;
            const selectedBookIds = (req.body.items || []).map(i => i.bookId?.toString());
            if (selectedBookIds.length > 0) {
                cartItems = cart.items.filter(item => selectedBookIds.includes(item.bookId.toString()));
                if (!cartItems.length) {
                    return response(res, 400, 'Không tìm thấy sản phẩm hợp lệ trong giỏ hàng.', { items: [] });
                }
            }
            const bookIds = cartItems.map((item) => item.bookId.toString());

            // Không kiểm tra địa chỉ giao hàng nữa

            // Lấy thông tin sách từ bookService
            const bookResponse = await axios.get(
                `${process.env.BOOK_SERVICE_URL}/api/books/multiple?ids=${bookIds.join(',')}`,
                { headers: { Authorization: userToken } }
            );
            const books = bookResponse.data.data.books;

            // Tính toán đơn hàng
            let totalAmount = 0;
            const orderItems = [];
            for (const item of cartItems) {
                const book = books.find((b) => b._id === item.bookId.toString());
                if (!book) {
                    return response(res, 404, `Sản phẩm với ID ${item.bookId} không còn tồn tại.`);
                }
                if (!book.availability || book.stockCount < item.quantity) {
                    return response(res, 400, `Sách "${book.title}" không đủ số lượng trong kho. Hiện có ${book.stockCount}.`);
                }
                orderItems.push({
                    bookId: item.bookId,
                    title: book.title,
                    originalPrice: book.price,
                    primaryImage: book.images?.[0]?.path || 'default_image_url',
                    price: book.price,
                    quantity: item.quantity
                });
                totalAmount += book.price * item.quantity;
            }

            const shippingFee = 30000; // Phí vận chuyển mặc định
            const finalAmount = totalAmount + shippingFee;

            return response(res, 200, 'Xem trước đơn hàng thành công', {
                items: orderItems,
                totalAmount,
                shippingFee,
                finalAmount
            });
        } catch (error) {
            next(error);
        }
    },
    // Kiểm tra bookId có trong đơn hàng nào không
    hasBookInOrder: async (req, res, next) => {
        try {
            const { bookId } = req.params;
            if (!mongoose.Types.ObjectId.isValid(bookId)) {
                return response(res, 400, 'ID sách không hợp lệ.', { hasOrder: false });
            }
            console.log(bookId);
            const order = await Order.findOne({ 'items.bookId': bookId });
            return response(res, 200, 'Kiểm tra đơn hàng chứa sách thành công.', { hasOrder: !!order });
        } catch (error) {
            next(error);
        }
    },
};

export default order_controller;