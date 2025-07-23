const response = (res, status, message = null, data = null) => {
    const isSuccess = status >= 200 && status < 300;
    return res.status(status).json({
        success: isSuccess,
        message: message || (isSuccess ? 'Success' : 'An error occurred'),
        data: data
    });
};
export default response;