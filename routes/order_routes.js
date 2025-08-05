import express from 'express';
import orderController from '../controllers/order_controller.js';
import verifyToken from '../middleware/verifyToken.js';
import checkAdminRole from '../middleware/checkAdminRole.js';

const orderRoutes = express.Router();

orderRoutes.post('/', verifyToken, orderController.createOrder);
orderRoutes.post('/create_payment_url', verifyToken, orderController.createPaymentUrl);
orderRoutes.get('/vnpay_return', orderController.vnpayReturn);
orderRoutes.get('/vnpay_ipn', orderController.vnpayIpn);
orderRoutes.get('/', verifyToken, orderController.getOrdersByUser);
orderRoutes.get('/all', verifyToken, checkAdminRole, orderController.getAllOrders);
orderRoutes.get('/total-revenue', verifyToken, checkAdminRole, orderController.getTotalRevenue);
orderRoutes.post('/preview', verifyToken, orderController.previewOrder);



orderRoutes.get('/:id', verifyToken, orderController.getOrderById);
orderRoutes.post('/:id/retry-payment', verifyToken, orderController.retryPayment);
orderRoutes.put('/:id', verifyToken, checkAdminRole, orderController.updateOrderStatus);
orderRoutes.delete('/:id', verifyToken, orderController.cancelOrder);

orderRoutes.get('/internal/has-book/:bookId', orderController.hasBookInOrder);

export default orderRoutes;