import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import orderRoutes from './routes/order_routes.js';
import cartRoutes from './routes/cart_routes.js';
import dbconnect from './config/db.js';
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