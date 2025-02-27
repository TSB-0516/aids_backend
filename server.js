// Import dependencies
const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

app.use(cors());
// Add these after your CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});


const PORT = 3000;
const API_URL = "https://api.upgrader.com/affiliate/creator/get-stats";
const API_KEY = "9c0cfe22-0028-48a5-badd-1ba6663a481a";
const MONGO_URI =
  "mongodb+srv://aids:aids@aidsgamble.run0e.mongodb.net/?retryWrites=true&w=majority&appName=aidsgamble";

// Connect to MongoDB
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Define Mongoose Schema & Models
const LeaderboardSchema = new mongoose.Schema({
  countdownEndTime: Number,
  summarizedBets: [{ username: String, wager: Number, avatar: String }],
});
const Leaderboard = mongoose.model("Leaderboard", LeaderboardSchema);

const ArchivedLeaderboard = mongoose.model(
  "ArchivedLeaderboard",
  LeaderboardSchema
);

// Get next Saturday midnight UTC
const getNextSaturdayMidnightUTC = () => {
  let now = new Date();
  let nextSaturday = new Date(now);
  let daysUntilSaturday = (6 - now.getUTCDay() + 7) % 7 || 7;
  nextSaturday.setUTCDate(now.getUTCDate() + daysUntilSaturday);
  nextSaturday.setUTCHours(0, 0, 0, 0);
  return nextSaturday.getTime();
};

// Fetch and store leaderboard data in MongoDB
const fetchData = async () => {
  try {
    const countdownEndTime = getNextSaturdayMidnightUTC();
    const fromDate = new Date(countdownEndTime - 7 * 24 * 60 * 60 * 1000);
    const toDate = new Date();

    const payload = {
      apikey: API_KEY,
      from: fromDate.toISOString().split("T")[0],
      to: toDate.toISOString().split("T")[0],
    };
    const response = await axios.post(API_URL, payload);

    if (!response.data.error) {
      console.log("Data fetched successfully");

      let summarizedBetsData = response.data.data.summarizedBets || [];

      // Transform data structure
      summarizedBetsData = summarizedBetsData.map((bet) => ({
        username: bet.user.username,
        avatar: bet.user.avatar,
        wager: (bet.wager / 100).toFixed(2), // Convert cents to dollars
      }));

      // Sort by wager descending
      summarizedBetsData.sort((a, b) => b.wager - a.wager);

      // Clear previous data and insert new leaderboard
      await Leaderboard.deleteMany({});
      await Leaderboard.create({
        countdownEndTime,
        summarizedBets: summarizedBetsData,
      });

      console.log("Leaderboard updated in database.");
    } else {
      console.error("API error:", response.data.msg);
    }
  } catch (error) {
    console.error("Error fetching data:", error.message);
  }
};

// Archive leaderboard at reset time
const archiveLeaderboard = async () => {
  try {
    const latestLeaderboard = await Leaderboard.findOne();
    if (!latestLeaderboard) return;

    // Check if an archived leaderboard already exists for this countdownEndTime
    const existingArchive = await ArchivedLeaderboard.findOne({
      countdownEndTime: latestLeaderboard.countdownEndTime,
    });

    if (existingArchive) {
      existingArchive.summarizedBets = latestLeaderboard.summarizedBets;
      await existingArchive.save();
      console.log("Archived leaderboard updated.");
    } else {
      await ArchivedLeaderboard.create(latestLeaderboard.toObject());
      console.log("New archived leaderboard created.");
    }

    // Clear current leaderboard after archiving
    await Leaderboard.deleteMany({});
  } catch (error) {
    console.error("Error archiving leaderboard:", error);
  }
};

// Auto-reset every week
setInterval(async () => {
  const now = Date.now();
  const resetTime = getNextSaturdayMidnightUTC();
  const lastReset = (await Leaderboard.findOne())?.countdownEndTime || 0;
  if (now >= resetTime && lastReset < resetTime) {
    await archiveLeaderboard();
    await fetchData();
    console.log("Leaderboard reset and archived.");
  }
}, 60000);

// Fetch data every 6 minutes
setInterval(fetchData, 360000);

// API Endpoints
app.get("/leaderboard", async (req, res) => {
  const leaderboard = await Leaderboard.findOne().lean(); // Convert to plain object

  if (leaderboard) {
    res.json({
      countdownEndTime: leaderboard.countdownEndTime,
      summarizedBets: leaderboard.summarizedBets
        .slice(0, 10)
        .map(({ _id, ...bet }) => bet), // Remove _id
    });
  } else {
    res.status(404).json({ error: "Leaderboard not found" });
  }
});

app.get("/previous-leaderboards", async (req, res) => {
  const archived = await ArchivedLeaderboard.find().lean(); // Convert to plain object

  const formattedArchived = archived.map((entry) => ({
    countdownEndTime: entry.countdownEndTime,
    summarizedBets: entry.summarizedBets
      .slice(0, 10)
      .map(({ _id, ...bet }) => bet), // Remove _id
  }));

  res.json(formattedArchived);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  fetchData();
});
