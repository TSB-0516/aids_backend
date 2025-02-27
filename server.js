// Import dependencies
const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());

const PORT = 3000;
const API_URL = "https://api.upgrader.com/affiliate/creator/get-stats";
const API_KEY = "9c0cfe22-0028-48a5-badd-1ba6663a481a";
const MONGO_URI = "mongodb+srv://aids:aids@aidsgamble.run0e.mongodb.net/?retryWrites=true&w=majority&appName=aidsgamble";

// Connect to MongoDB
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Define Mongoose Schema & Models
const LeaderboardSchema = new mongoose.Schema({
  countdownEndTime: Number,
  summarizedBets: [{ username: String, wager: Number }],
});
const Leaderboard = mongoose.model("Leaderboard", LeaderboardSchema);

const ArchivedLeaderboard = mongoose.model(
  "ArchivedLeaderboard",
  LeaderboardSchema
);

// Get next Friday midnight UTC
const getNextFridayMidnightUTC = () => {
  let now = new Date();
  let nextFriday = new Date(now);
  // 5 represents Friday in getUTCDay() (0 = Sunday, 1 = Monday, ..., 5 = Friday)
  let daysUntilFriday = (5 - now.getUTCDay() + 7) % 7 || 7;
  nextFriday.setUTCDate(now.getUTCDate() + daysUntilFriday);
  nextFriday.setUTCHours(0, 0, 0, 0);
  return nextFriday.getTime();
};

// Fetch and store leaderboard data in MongoDB
const fetchData = async () => {
  try {
    const countdownEndTime = getNextFridayMidnightUTC();
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
      summarizedBetsData = summarizedBetsData.map((bet) => ({
        ...bet,
        wager: (bet.wager / 100).toFixed(2),
      }));
      summarizedBetsData.sort((a, b) => b.wager - a.wager);

      await Leaderboard.deleteMany({}); // Clear previous data
      await Leaderboard.create({
        countdownEndTime,
        summarizedBets: summarizedBetsData,
      });
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
      // Update existing archived leaderboard
      existingArchive.summarizedBets = latestLeaderboard.summarizedBets;
      await existingArchive.save();
      console.log("Archived leaderboard updated.");
    } else {
      // Create a new archived leaderboard entry
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
  const resetTime = getNextFridayMidnightUTC();
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
  const leaderboard = await Leaderboard.findOne();
  if (leaderboard) {
    res.json(leaderboard);
  } else {
    res.status(404).json({ error: "Leaderboard not found" });
  }
});

app.get("/previous-leaderboards", async (req, res) => {
  const archived = await ArchivedLeaderboard.find();
  res.json(archived);
});

app.listen(PORT, () => {
  console.log(Server running on port ${PORT});
  fetchData();
});
