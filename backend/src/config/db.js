import mongoose from "mongoose";

const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    console.warn("MongoDB URI not configured. Continuing without database connection.");
    return false;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected successfully");
    console.log("Database:", mongoose.connection.name);
    return true;
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    console.warn("Continuing without database connection for local development.");
    return false;
  }
};

export default connectDB;