import mongoose from "mongoose";

const dbconnect=async()=>{
    const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017/bookstore';
    await mongoose.connect(mongoUrl)
    await console.log('da ket noi voi mongodb')

}
export default dbconnect;