import response from '../utils/response.js';

const checkAdminRole = (req, res, next) => {
    if (!req.user || !req.user.role) {
        return response(res, 401, 'Không có thông tin quyền hạn. Vui lòng đăng nhập lại.');
    }
    if (req.user.role === 'admin') {
        next();
    } else {
        return response(res, 403, 'Bạn không có quyền truy cập chức năng này. Yêu cầu quyền quản trị viên.');
    }
};

export default checkAdminRole;