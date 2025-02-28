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

// Changed from Saturday to Friday
const getNextFridayMidnightUTC = () => {
  let now = new Date();
  let nextFriday = new Date(now);
  let daysUntilFriday = (5 - now.getUTCDay() + 7) % 7;
  nextFriday.setUTCDate(now.getUTCDate() + daysUntilFriday);
  nextFriday.setUTCHours(0, 0, 0, 0);
  return nextFriday.getTime();
};

// Fetch and store leaderboard data in MongoDB
const fetchData = async (isReset = false) => {
  try {
    const countdownEndTime = getNextFridayMidnightUTC();
    
    // If it's a reset, start from current time, otherwise look back to previous Friday
    const fromDate = isReset 
      ? new Date() 
      : new Date(countdownEndTime - 7 * 24 * 60 * 60 * 1000);
    const toDate = new Date();

    console.log('Fetching data with range:', {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      isReset: isReset
    });

    const payload = {
      apikey: API_KEY,
      from: fromDate.toISOString().split("T")[0],
      to: toDate.toISOString().split("T")[0],
    };

    const response = await axios.post(API_URL, payload);

    if (!response.data.error) {
      console.log("Data fetched successfully");
      let summarizedBetsData = response.data.data.summarizedBets || [];
      console.log(`Received ${summarizedBetsData.length} bets from API`);

      // Transform data structure and ensure wager is a number
      summarizedBetsData = summarizedBetsData.map((bet) => ({
        username: bet.user.username,
        avatar: bet.user.avatar,
        wager: parseFloat((bet.wager / 100).toFixed(2)),
      }));

      // Sort by wager descending
      summarizedBetsData.sort((a, b) => b.wager - a.wager);

      // Create new leaderboard
      const newLeaderboard = await Leaderboard.create({
        countdownEndTime,
        summarizedBets: summarizedBetsData,
      });

      console.log(`Leaderboard updated with ${summarizedBetsData.length} entries, next reset at ${new Date(countdownEndTime).toISOString()}`);
      return newLeaderboard;
    } else {
      console.error("API error:", response.data);
      return null;
    }
  } catch (error) {
    console.error("Error fetching data:", error.message);
    if (error.response) {
      console.error("API Response Error Data:", error.response.data);
    }
    return null;
  }
};

// Archive leaderboard at reset time
const archiveLeaderboard = async () => {
  try {
    const latestLeaderboard = await Leaderboard.findOne();
    if (!latestLeaderboard) {
      console.log("No leaderboard to archive");
      return;
    }

    console.log("Archiving leaderboard for period ending:", new Date(latestLeaderboard.countdownEndTime).toISOString());

    // Check if an archived leaderboard already exists for this countdownEndTime
    const existingArchive = await ArchivedLeaderboard.findOne({
      countdownEndTime: latestLeaderboard.countdownEndTime,
    });

    if (existingArchive) {
      existingArchive.summarizedBets = latestLeaderboard.summarizedBets;
      await existingArchive.save();
      console.log("Updated existing archive");
    } else {
      await ArchivedLeaderboard.create(latestLeaderboard.toObject());
      console.log("Created new archive");
    }

    // Clear the current leaderboard after successful archive
    await Leaderboard.deleteMany({});
    console.log("Current leaderboard cleared after archiving");
  } catch (error) {
    console.error("Error archiving leaderboard:", error);
  }
};

// Combined interval for both reset checking and data fetching
const updateInterval = async () => {
  try {
    const now = Date.now();
    const resetTime = getNextFridayMidnightUTC();
    const currentLeaderboard = await Leaderboard.findOne();
    const lastResetTime = currentLeaderboard?.countdownEndTime || 0;

    console.log('Checking update/reset status:', {
      currentTime: new Date(now).toISOString(),
      nextResetTime: new Date(resetTime).toISOString(),
      lastResetTime: lastResetTime ? new Date(lastResetTime).toISOString() : 'No previous reset',
      shouldReset: now >= resetTime && lastResetTime < resetTime,
      nextUpdateIn: '5 minutes and 30 seconds'
    });

    if (now >= resetTime && lastResetTime < resetTime) {
      console.log("Starting reset process...");
      await archiveLeaderboard();
      const newLeaderboard = await fetchData(true); // Reset fetch
      if (newLeaderboard) {
        console.log("Reset completed successfully with new data");
      } else {
        console.error("Reset completed but new data fetch failed");
      }
    } else {
      // Regular update
      console.log("Starting regular update...");
      await fetchData(false);
    }
  } catch (error) {
    console.error("Error in update interval:", error);
  }
};

// Update interval set to 5 minutes and 30 seconds (330000 ms)
const UPDATE_INTERVAL = 330000; // 5.5 minutes in milliseconds
setInterval(updateInterval, UPDATE_INTERVAL);

// Initial fetch when server starts
console.log(`Server starting with update interval of 5 minutes and 30 seconds (${UPDATE_INTERVAL}ms)`);
updateInterval().catch(error => console.error("Error in initial update:", error));

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
  updateInterval().catch(error => console.error("Error in initial update:", error));
});
