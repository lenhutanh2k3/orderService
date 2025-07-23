import { body, validationResult } from 'express-validator';
import { PAYMENT_METHOD } from '../utils/orderConstants.js';

export const validateCreateOrder = [
    // Xác thực phoneNumber
    body('phoneNumber')
        .isString()
        .withMessage('Số điện thoại phải là chuỗi.')
        .matches(/^[0-9]{10,11}$/)
        .withMessage('Số điện thoại phải có 10 hoặc 11 chữ số.')
        .notEmpty()
        .withMessage('Số điện thoại không được để trống.'),

    // Xác thực fullName
    body('fullName')
        .isString()
        .withMessage('Họ và tên phải là chuỗi.')
        .isLength({ min: 2, max: 50 })
        .withMessage('Họ và tên phải có độ dài từ 2 đến 50 ký tự.')
        .notEmpty()
        .withMessage('Họ và tên không được để trống.'),

    // Xác thực paymentMethod
    body('paymentMethod')
        .isIn(Object.values(PAYMENT_METHOD))
        .withMessage('Phương thức thanh toán phải là COD hoặc VNPAY.')
        .notEmpty()
        .withMessage('Phương thức thanh toán không được để trống.'),

    // Xác thực savedAddressId
    body('savedAddressId')
        .optional()
        .isMongoId()
        .withMessage('ID địa chỉ không hợp lệ.'),

    // Xác thực shippingAddress
    body('shippingAddress')
        .if((value, { req }) => !req.body.savedAddressId)
        .notEmpty()
        .withMessage('Phải cung cấp shippingAddress khi không chọn savedAddressId.')
        .isObject()
        .withMessage('Địa chỉ giao hàng phải là một đối tượng.'),
    body('shippingAddress.address')
        .if((value, { req }) => !req.body.savedAddressId)
        .isString()
        .withMessage('Địa chỉ cụ thể phải là chuỗi.')
        .notEmpty()
        .withMessage('Địa chỉ cụ thể không được để trống.'),
    body('shippingAddress.ward')
        .if((value, { req }) => !req.body.savedAddressId)
        .isString()
        .withMessage('Phường/Xã phải là chuỗi.')
        .notEmpty()
        .withMessage('Phường/Xã không được để trống.'),
    body('shippingAddress.district')
        .if((value, { req }) => !req.body.savedAddressId)
        .isString()
        .withMessage('Quận/Huyện phải là chuỗi.')
        .notEmpty()
        .withMessage('Quận/Huyện không được để trống.'),
    body('shippingAddress.city')
        .if((value, { req }) => !req.body.savedAddressId)
        .isString()
        .withMessage('Tỉnh/Thành phố phải là chuỗi.')
        .notEmpty()
        .withMessage('Tỉnh/Thành phố không được để trống.'),

    // Xác thực items
    body('items')
        .isArray({ min: 1 })
        .withMessage('Phải có ít nhất một sản phẩm trong đơn hàng.'),
    body('items.*.bookId')
        .isMongoId()
        .withMessage('ID sách không hợp lệ.')
        .notEmpty()
        .withMessage('ID sách không được để trống.'),
    body('items.*.quantity')
        .isInt({ min: 1 })
        .withMessage('Số lượng phải là số nguyên lớn hơn hoặc bằng 1.')
        .notEmpty()
        .withMessage('Số lượng không được để trống.'),

    // Xác thực note
    body('note')
        .optional()
        .isString()
        .withMessage('Ghi chú phải là chuỗi.'),

    // Xử lý lỗi xác thực
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const errorMessages = errors.array().map(err => err.msg).join('; ');
            return res.status(400).json({
                success: false,
                message: errorMessages,
                errors: errors.array(),
            });
        }
        next();
    },
];