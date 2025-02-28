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

// Get the last Friday midnight UTC
const getLastFridayMidnightUTC = () => {
  let now = new Date();
  let lastFriday = new Date(now);
  let daysSinceLastFriday = (now.getUTCDay() - 5 + 7) % 7;
  lastFriday.setUTCDate(now.getUTCDate() - daysSinceLastFriday);
  lastFriday.setUTCHours(0, 0, 0, 0);
  return lastFriday.getTime();
};

// Get the next Friday midnight UTC
const getNextFridayMidnightUTC = () => {
  let now = new Date();
  let nextFriday = new Date(now);
  let daysUntilFriday = (5 - now.getUTCDay() + 7) % 7 || 7;
  nextFriday.setUTCDate(now.getUTCDate() + daysUntilFriday);
  nextFriday.setUTCHours(0, 0, 0, 0);
  return nextFriday.getTime();
};

// Fetch and store leaderboard data in MongoDB
const fetchData = async () => {
  try {
    const countdownEndTime = getNextFridayMidnightUTC();
    // Calculate fromDate as the last Friday midnight UTC
    const fromDate = new Date(getLastFridayMidnightUTC());
    const toDate = new Date();

    console.log('Fetching data with params:', {
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString(),
      countdownEndTime: new Date(countdownEndTime).toISOString()
    });

    const payload = {
      apikey: API_KEY,
      from: fromDate.toISOString().split("T")[0],
      to: toDate.toISOString().split("T")[0],
    };

    console.log('Making API request with payload:', payload);
    const response = await axios.post(API_URL, payload);

    if (!response.data.error) {
      console.log("Data fetched successfully:", response.data);

      let summarizedBetsData = response.data.data.summarizedBets || [];
      console.log('Raw summarized bets:', summarizedBetsData);

      if (summarizedBetsData.length === 0) {
        console.log('Warning: No bets data received from API');
      }

      // Transform data structure
      summarizedBetsData = summarizedBetsData.map((bet) => ({
        username: bet.user.username,
        avatar: bet.user.avatar,
        wager: parseFloat((bet.wager / 100).toFixed(2)), // Convert cents to dollars and ensure number type
      }));

      console.log('Transformed bets data:', summarizedBetsData);

      // Sort by wager descending
      summarizedBetsData.sort((a, b) => b.wager - a.wager);

      // Clear previous data and insert new leaderboard
      await Leaderboard.deleteMany({});
      const newLeaderboard = await Leaderboard.create({
        countdownEndTime,
        summarizedBets: summarizedBetsData,
      });

      console.log("Leaderboard updated in database:", newLeaderboard);
    } else {
      console.error("API error:", response.data);
    }
  } catch (error) {
    console.error("Error fetching data:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
  }
};

// Archive leaderboard at reset time
const archiveLeaderboard = async () => {
  try {
    const latestLeaderboard = await Leaderboard.findOne();
    if (!latestLeaderboard) {
      console.log("No leaderboard found to archive");
      return;
    }

    // Get the last Friday midnight for proper archiving
    const lastFridayMidnight = getLastFridayMidnightUTC();
    
    // Create archive with the correct timestamp
    const archiveData = {
      ...latestLeaderboard.toObject(),
      countdownEndTime: lastFridayMidnight
    };

    // Check if an archived leaderboard already exists for this period
    const existingArchive = await ArchivedLeaderboard.findOne({
      countdownEndTime: lastFridayMidnight
    });

    if (existingArchive) {
      existingArchive.summarizedBets = archiveData.summarizedBets;
      await existingArchive.save();
      console.log("Archived leaderboard updated for timestamp:", new Date(lastFridayMidnight).toISOString());
    } else {
      await ArchivedLeaderboard.create(archiveData);
      console.log("New archived leaderboard created for timestamp:", new Date(lastFridayMidnight).toISOString());
    }

    // Clear current leaderboard after archiving
    await Leaderboard.deleteMany({});
    console.log("Current leaderboard cleared after archiving");
  } catch (error) {
    console.error("Error archiving leaderboard:", error);
  }
};

// Update auto-reset interval to use new timing function
setInterval(async () => {
  const now = Date.now();
  const resetTime = getNextFridayMidnightUTC();
  const lastReset = (await Leaderboard.findOne())?.countdownEndTime || 0;
  
  // Check if we're past the reset time and haven't reset yet
  if (now >= resetTime && lastReset < resetTime) {
    console.log("Starting reset process at:", new Date(now).toISOString());
    console.log("Reset time was:", new Date(resetTime).toISOString());
    console.log("Last reset was:", new Date(lastReset).toISOString());
    
    await archiveLeaderboard();
    await fetchData();
    console.log("Leaderboard reset and archived completed");
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

// Immediately fetch data when server starts
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await mongoose.connection.db.admin().ping();
    console.log("MongoDB connection verified");
    await fetchData();
  } catch (error) {
    console.error("Error during startup:", error);
  }
});
