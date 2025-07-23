import jwt from 'jsonwebtoken';
import response from '../utils/response.js';
import dotenv from 'dotenv';
dotenv.config();

const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return response(res, 401, 'Không có token xác thực.');
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
        return response(res, 401, 'Token không hợp lệ.');
    }
    try {
        const decoded = jwt.verify(token, process.env.SECRET_KEY);
        console.log(decoded);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('Verify token error:', error);

        if (error.name === 'TokenExpiredError') {
            return response(res, 401, 'Token đã hết hạn. Vui lòng đăng nhập lại.');
        } else if (error.name === 'JsonWebTokenError') {
            return response(res, 401, 'Token không hợp lệ.');
        } else {
            return response(res, 401, 'Token không hợp lệ hoặc đã hết hạn.');
        }
    }
};

export default verifyToken;