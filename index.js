import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cors from "cors";

const app = express();
dotenv.config();

// Middleware
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 6000;
const MONGOURL = process.env.MONGODB_URI || "mongodb+srv://Meghana:MeghU%402812@cluster0.7vy2k.mongodb.net/BankDB?retryWrites=true&w=majority";

// MongoDB connection with better error handling
mongoose.connect(MONGOURL).then(()=>{
    console.log("Database is connected successfully");
    app.listen(PORT, ()=>{
        console.log(`Server is running on port ${PORT}`);
    });
})
.catch((error)=> console.log(error));


// Transaction Schema
const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['deposit', 'withdraw', 'transfer'], required: true },
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// Improved User Schema
const userSchema = new mongoose.Schema({
    fullname: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    phoneNumber: String,
    userId: { type: String, unique: true },
    accountNumber: String,
    branch: String,
    balance: { type: Number, default: 0 },
    transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }]
});

const User = mongoose.model("users", userSchema);

// Register Route with better validation
app.post("/register", async (req, res) => {
    try {
        const { fullname, email, password, phoneNumber, userId, accountNumber, branch } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ $or: [{ email }, { userId }] });
        if (existingUser) {
            return res.status(400).json({ message: "User already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            fullname,
            email,
            password: hashedPassword,
            phoneNumber,
            userId,
            accountNumber,
            branch
        });

        await newUser.save();
        res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ message: "Error registering user", error: error.message });
    }
});

// Login Route
app.post("/login", async (req, res) => {
    try {
        const { userId, password } = req.body;

        // Check if the user exists
        const user = await User.findOne({ userId });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Compare the provided password with the stored hashed password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        // Generate a JWT token
        const token = jwt.sign({ userId: user.userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({
            message: "Login successful",
            token: `Bearer ${token}` // Send token to client
        });
    } catch (error) { 
        console.error("Login error:", error);
        res.status(500).json({ message: "Error logging in", error: error.message });
    }
});


// Improved authentication middleware
const authenticateUser = (req, res, next) => {
    const token = req.header("Authorization");
    if (!token) {
        return res.status(401).json({ message: "Access denied" });
    }

    try {
        const decoded = jwt.verify(token.split(' ')[1], process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        console.error("Authentication error:", error);
        res.status(400).json({ message: "Invalid token" });
    }
};

// Improved deposit route with transaction recording
app.post("/deposit", authenticateUser, async (req, res) => {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Invalid amount" });
    }

    try {
        const user = await User.findOne({ userId: req.user.userId });
        if (!user) return res.status(404).json({ message: "User not found" });

        user.balance += amount;
        await user.save();

        // Record transaction
        const transaction = new Transaction({
            userId: user._id,
            type: 'deposit',
            amount
        });
        await transaction.save();

        user.transactions.push(transaction._id);
        await user.save();

        res.status(200).json({ 
            message: "Deposit successful", 
            balance: user.balance,
            transaction: transaction
        });
    } catch (error) {
        console.error("Deposit error:", error);
        res.status(500).json({ message: "Error during deposit", error: error.message });
    }
});

// Improved withdrawal route with transaction recording
app.post("/withdraw", authenticateUser, async (req, res) => {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Invalid amount" });
    }

    try {
        const user = await User.findOne({ userId: req.user.userId });
        if (!user) return res.status(404).json({ message: "User not found" });

        if (user.balance < amount) {
            return res.status(400).json({ message: "Insufficient balance" });gfr3
        }

        user.balance -= amount;
        await user.save();

        // Record transaction
        const transaction = new Transaction({
            userId: user._id,
            type: 'withdraw',
            amount
        });
        await transaction.save();

        user.transactions.push(transaction._id);
        await user.save();

        res.status(200).json({ 
            message: "Withdrawal successful", 
            balance: user.balance,
            transaction: transaction
        });
    } catch (error) {
        console.error("Withdrawal error:", error);
        res.status(500).json({ message: "Error during withdrawal", error: error.message });
    }
});

// Improved transfer route with better error handling and transaction recording
app.post("/transfer", authenticateUser, async (req, res) => {
    const { recipientUserId, amount } = req.body;
    if (!amount || amount <= 0 || !recipientUserId) {
        return res.status(400).json({ message: "Invalid transfer details" });
    }

    try {
        const sender = await User.findOne({ userId: req.user.userId });
        const recipient = await User.findOne({ userId: recipientUserId });

        if (!sender || !recipient) {
            return res.status(404).json({ message: "Sender or recipient not found" });
        }

        if (sender.balance < amount) {
            return res.status(400).json({ message: "Insufficient balance" });
        }

        // Create transactions for both parties
        const senderTransaction = new Transaction({
            userId: sender._id,
            type: 'transfer',
            amount: -amount
        });

        const recipientTransaction = new Transaction({
            userId: recipient._id,
            type: 'transfer',
            amount: amount
        });

        // Update balances and save transactions
        sender.balance -= amount;
        recipient.balance += amount;

        await Promise.all([
            senderTransaction.save(),
            recipientTransaction.save(),
            sender.save(),
            recipient.save()
        ]);

        sender.transactions.push(senderTransaction._id);
        recipient.transactions.push(recipientTransaction._id);
        
        await Promise.all([sender.save(), recipient.save()]);

        res.status(200).json({ 
            message: "Transfer successful", 
            senderBalance: sender.balance
        });
    } catch (error) {
        console.error("Transfer error:", error);
        res.status(500).json({ message: "Error during transfer", error: error.message });
    }
});

// New route: Transaction history
app.get("/transactions", authenticateUser, async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.user.userId })
            .populate('transactions');
        
        if (!user) return res.status(404).json({ message: "User not found" });

        res.status(200).json({ 
            transactions: user.transactions,
            balance: user.balance
        });
    } catch (error) {
        console.error("Transaction history error:", error);
        res.status(500).json({ message: "Error fetching transactions", error: error.message });
    }
});









