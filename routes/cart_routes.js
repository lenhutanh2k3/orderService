import express from 'express';
import cart_controller from '../controllers/cart_controller.js';
import verifyToken from '../middleware/verifyToken.js';

const cartRouter = express.Router();

cartRouter.use(verifyToken);
cartRouter.get('/', cart_controller.getCart);
cartRouter.post('/add', cart_controller.addToCart);
cartRouter.put('/update', cart_controller.updateCartItem);
cartRouter.delete('/remove', cart_controller.removeFromCart);
cartRouter.delete('/clear', cart_controller.clearCart);

export default cartRouter;